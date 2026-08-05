/**
 * Security Tool Runners
 *
 * Runners for security scanning tools: Opengrep (open-source Semgrep fork)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Finding } from "../../core/types.js";
import { EXCLUDE_DIRS_COMMON, isToolAvailable } from "../tool-utils.js";
import { parseOpengrepOutput } from "../../parsers/index.js";
import { MAX_OUTPUT_BUFFER } from "../../utils/shared.js";

const OPENGREP_RULES_REPO = "https://github.com/opengrep/opengrep-rules.git";

/**
 * Locate a local opengrep ruleset, cloning the community rules on first use.
 * Opengrep has no hosted rule registry (semgrep's "p/..." aliases are served
 * by semgrep.dev and license-restricted), so rules must exist on disk.
 * Resolution order: explicit config path -> VIBECHECK_OPENGREP_RULES env ->
 * cached clone under ~/.cache/vibecheck.
 */
function resolveOpengrepRules(configPath?: string): string | null {
  if (configPath) return configPath;

  const envPath = process.env.VIBECHECK_OPENGREP_RULES;
  if (envPath) return envPath;

  const cacheDir = join(homedir(), ".cache", "vibecheck", "opengrep-rules");
  if (existsSync(cacheDir)) return cacheDir;

  console.log("  Cloning opengrep-rules (first run)...");
  const clone = spawnSync(
    "git",
    ["clone", "--depth", "1", OPENGREP_RULES_REPO, cacheDir],
    { encoding: "utf-8" },
  );
  if (clone.status === 0) return cacheDir;

  console.log("  Could not clone opengrep rules, skipping");
  return null;
}

/**
 * Collect the security rule directories from an opengrep-rules checkout,
 * mirroring the scope of semgrep's old "p/security-audit" ruleset.
 * Falls back to the ruleset root for custom rule layouts without
 * security subdirectories.
 */
function collectSecurityRuleDirs(rulesRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.name === "security") {
        found.push(path);
      } else if (depth < 4) {
        walk(path, depth + 1);
      }
    }
  };
  walk(rulesRoot, 0);
  return found.length > 0 ? found : [rulesRoot];
}

/**
 * Run Opengrep for security vulnerability detection.
 */
export function runOpengrep(rootPath: string, configPath?: string): Finding[] {
  console.log("Running opengrep...");

  try {
    const { available } = isToolAvailable("opengrep", false); // native binary, no npx
    if (!available) {
      console.log("  Opengrep not installed, skipping");
      return [];
    }

    const rulesRoot = resolveOpengrepRules(configPath);
    if (!rulesRoot) {
      return [];
    }

    const args = [
      "scan",
      "--json",
      ...collectSecurityRuleDirs(rulesRoot).flatMap((dir) => [
        "--config",
        dir,
      ]),
      "--exclude",
      EXCLUDE_DIRS_COMMON,
      ".",
    ];

    const result = spawnSync("opengrep", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: MAX_OUTPUT_BUFFER,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    // Opengrep outputs JSON mixed with progress info, extract JSON portion
    const output = result.stdout || "";
    const jsonMatch = output.match(/\{[\s\S]*"version"[\s\S]*\}(?=\s*$)/);
    if (jsonMatch) {
      try {
        const opengrepOutput = JSON.parse(jsonMatch[0]);
        return parseOpengrepOutput(opengrepOutput);
      } catch (e) {
        console.warn("Failed to parse opengrep JSON output:", e);
      }
    }
  } catch (error) {
    console.warn("opengrep failed:", error);
  }

  return [];
}
