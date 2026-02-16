/**
 * Tool Runners
 *
 * Main entry point for all tool runners.
 * Re-exports language-specific runners from ./runners/ modules.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../core/types.js";
import { extractJsonFromMixedOutput } from "./tool-utils.js";
import { parseTrunkOutput } from "../parsers/index.js";
import { MAX_OUTPUT_BUFFER, TOOL_INIT_TIMEOUT_MS } from "../utils/shared.js";

// Re-export all language-specific runners
export {
  runTsc,
  runJscpd,
  runDependencyCruiser,
  runKnip,
  runEslint,
} from "./runners/typescript.js";
export { runRuff, runMypy, runBandit, runVulture } from "./runners/python.js";
export { runPmd, runSpotBugs } from "./runners/java.js";
export { runSemgrep } from "./runners/security.js";
export { runClippy, runCargoAudit, runCargoDeny } from "./runners/rust.js";

// ============================================================================
// Trunk Runner (kept here due to complexity and special handling)
// ============================================================================

/**
 * Run Trunk check and capture output.
 * Trunk wraps multiple linters (ESLint, Prettier, etc.)
 */
export function runTrunk(
  rootPath: string,
  args: string[] = ["check", "--all"],
): Finding[] {
  console.log("Running Trunk...");

  try {
    // Check for TRUNK_PATH env var (set by trunk-io/trunk-action/setup)
    const trunkPathEnv = process.env.TRUNK_PATH;
    let trunkCmd: string[];

    if (trunkPathEnv) {
      // Use trunk from TRUNK_PATH (set by GitHub Action)
      const versionCheck = spawnSync(trunkPathEnv, ["--version"], {
        encoding: "utf-8",
        shell: true,
      });
      if (versionCheck.status === 0) {
        console.log(`  Using trunk from TRUNK_PATH: ${trunkPathEnv}`);
        trunkCmd = [trunkPathEnv];
      } else {
        console.log(
          `  TRUNK_PATH set but trunk not working: ${versionCheck.stderr}`,
        );
        trunkCmd = [];
      }
    } else {
      // Check if trunk is available (via npm or global install)
      const versionCheck = spawnSync("pnpm", ["exec", "trunk", "--version"], {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
      });

      if (versionCheck.error || versionCheck.status !== 0) {
        // Try global trunk
        const globalCheck = spawnSync("trunk", ["--version"], {
          encoding: "utf-8",
          shell: true,
        });
        if (globalCheck.error || globalCheck.status !== 0) {
          console.log("  Trunk not installed, skipping");
          return [];
        }
        trunkCmd = ["trunk"];
      } else {
        trunkCmd = ["pnpm", "exec", "trunk"];
      }
    }

    if (trunkCmd.length === 0) {
      console.log("  Trunk not installed, skipping");
      return [];
    }

    // Check if trunk is initialized in the repo, if not, initialize it
    const trunkConfigPath = join(rootPath, ".trunk", "trunk.yaml");
    if (!existsSync(trunkConfigPath)) {
      console.log("  Trunk not initialized, running trunk init...");
      const initResult = spawnSync(
        trunkCmd[0],
        [...trunkCmd.slice(1), "init", "-n"],
        {
          cwd: rootPath,
          encoding: "utf-8",
          shell: true,
          timeout: TOOL_INIT_TIMEOUT_MS,
        },
      );
      if (initResult.status !== 0) {
        console.log(
          `  Trunk init failed: ${initResult.stderr || initResult.stdout}`,
        );
        return [];
      }
      console.log("  Trunk initialized successfully");
    }

    const trunkArgs = [...args, "--output=json", "--no-progress"];
    console.log(
      `  Running: ${trunkCmd[0]} ${[...trunkCmd.slice(1), ...trunkArgs].join(" ")}`,
    );

    const trunkResult = spawnSync(
      trunkCmd[0],
      [...trunkCmd.slice(1), ...trunkArgs],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: MAX_OUTPUT_BUFFER,
      },
    );

    // Trunk outputs JSON but may include ANSI codes, extract JSON portion
    const output = trunkResult.stdout || "";
    const stderr = trunkResult.stderr || "";

    console.log(`  Trunk exit code: ${trunkResult.status}`);
    if (stderr && stderr.length < 500) {
      console.log(`  Trunk stderr: ${stderr}`);
    }

    // Extract JSON from mixed output (handles ANSI codes)
    // Try to find JSON with "issues" field first, then fall back to any JSON
    let jsonStr = extractJsonFromMixedOutput(output, "issues");
    if (!jsonStr) {
      // Trunk may return JSON without issues field when there are no findings
      jsonStr = extractJsonFromMixedOutput(output);
    }

    if (jsonStr) {
      try {
        const trunkOutput = JSON.parse(jsonStr);
        // Check if issues field exists
        if (!trunkOutput.issues || trunkOutput.issues.length === 0) {
          const fileCount = trunkOutput.checkStats?.fileCount || "unknown";
          console.log(`  Trunk checked ${fileCount} files, no issues found`);
          return [];
        }
        const findings = parseTrunkOutput(trunkOutput);
        console.log(`  Parsed ${findings.length} findings from trunk JSON`);
        return findings;
      } catch (e) {
        console.warn("Failed to parse Trunk JSON output:", e);
      }
    } else {
      console.log("  No JSON found in trunk output");
      if (output.length < 1000) {
        console.log("  Output:", output);
      }
    }
  } catch (error) {
    console.warn("Trunk not available or failed:", error);
  }

  return [];
}
