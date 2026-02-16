/**
 * Python Tool Runners
 *
 * Runners for Python analysis tools: Ruff, Mypy, Bandit, Vulture
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../../core/types.js";
import {
  EXCLUDE_DIRS_PYTHON,
  isToolAvailable,
  safeParseJson,
} from "../tool-utils.js";
import {
  parseRuffOutput,
  parseMypyOutput,
  parseBanditOutput,
  parseVultureOutput,
  type BanditOutput,
} from "../../parsers/index.js";
import { MAX_OUTPUT_BUFFER } from "../../utils/shared.js";

/**
 * Run Ruff linter for Python code.
 */
export function runRuff(rootPath: string, configPath?: string): Finding[] {
  console.log("Running ruff...");

  try {
    const { available } = isToolAvailable("ruff", false);
    if (!available) {
      console.log("  Ruff not installed, skipping");
      return [];
    }

    const args = [
      "check",
      "--output-format",
      "json",
      "--exclude",
      EXCLUDE_DIRS_PYTHON,
    ];
    if (configPath) {
      args.push("--config", configPath);
    }
    args.push(".");

    const result = spawnSync("ruff", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: MAX_OUTPUT_BUFFER,
    });

    // Ruff outputs JSON array to stdout
    const output = result.stdout || "";
    if (output.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(output);
        return parseRuffOutput(parsed, rootPath);
      } catch {
        console.warn("Failed to parse ruff JSON output");
      }
    }
  } catch (error) {
    console.warn("ruff failed:", error);
  }

  return [];
}

/**
 * Check if the target project has its own mypy configuration.
 * When a project config exists, we respect their import settings.
 */
function hasProjectMypyConfig(rootPath: string): boolean {
  if (existsSync(join(rootPath, "mypy.ini"))) return true;
  if (existsSync(join(rootPath, ".mypy.ini"))) return true;

  const pyprojectPath = join(rootPath, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, "utf-8");
      if (content.includes("[tool.mypy]")) return true;
    } catch {
      // ignore
    }
  }

  const setupCfgPath = join(rootPath, "setup.cfg");
  if (existsSync(setupCfgPath)) {
    try {
      const content = readFileSync(setupCfgPath, "utf-8");
      if (content.includes("[mypy]")) return true;
    } catch {
      // ignore
    }
  }

  return false;
}

/**
 * Run Mypy type checker for Python code.
 */
export function runMypy(rootPath: string, configPath?: string): Finding[] {
  console.log("Running mypy...");

  try {
    const { available } = isToolAvailable("mypy", false);
    if (!available) {
      console.log("  Mypy not installed, skipping");
      return [];
    }

    // Use --output=json for native JSON output (Python 3.10+)
    const args = ["--output", "json", "--exclude", EXCLUDE_DIRS_PYTHON];

    // When no project-level mypy config exists, add --ignore-missing-imports
    // to prevent false positives from unresolved third-party imports.
    // This also prevents cascading attr-defined, arg-type, return-value errors.
    if (!configPath && !hasProjectMypyConfig(rootPath)) {
      args.push("--ignore-missing-imports");
      console.log("  No mypy config found, adding --ignore-missing-imports");
    }

    if (configPath) {
      args.push("--config-file", configPath);
    }
    args.push(".");

    const result = spawnSync("mypy", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: MAX_OUTPUT_BUFFER,
    });

    // Mypy JSON output is one JSON object per line
    const output = result.stdout || "";
    const errors: Array<{
      file: string;
      line: number;
      column: number;
      message: string;
      hint: string | null;
      code: string | null;
      severity: string;
    }> = [];

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try {
          errors.push(JSON.parse(trimmed));
        } catch {
          // skip malformed lines
        }
      }
    }

    if (errors.length > 0) {
      return parseMypyOutput(errors, rootPath);
    }
  } catch (error) {
    console.warn("mypy failed:", error);
  }

  return [];
}

/**
 * Run Bandit security scanner for Python code.
 */
export function runBandit(rootPath: string, configPath?: string): Finding[] {
  console.log("Running bandit...");

  try {
    const { available } = isToolAvailable("bandit", false);
    if (!available) {
      console.log("  Bandit not installed, skipping");
      return [];
    }

    const args = ["-f", "json", "-r", ".", "--exclude", EXCLUDE_DIRS_PYTHON];
    if (configPath) {
      args.push("-c", configPath);
    }

    const result = spawnSync("bandit", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: MAX_OUTPUT_BUFFER,
    });

    // Bandit outputs JSON to stdout
    const output = result.stdout || "";
    const parsed = safeParseJson<BanditOutput>(output);
    if (parsed) {
      return parseBanditOutput(parsed, rootPath);
    }
  } catch (error) {
    console.warn("bandit failed:", error);
  }

  return [];
}

/**
 * Run Vulture dead code detector for Python code.
 */
export function runVulture(rootPath: string, configPath?: string): Finding[] {
  console.log("Running vulture...");

  try {
    const { available } = isToolAvailable("vulture", false);
    if (!available) {
      console.log("  Vulture not installed, skipping");
      return [];
    }

    const args = ["."];
    if (configPath) {
      args.push("--config", configPath);
    } else {
      args.push("--min-confidence", "60");
    }
    args.push("--exclude", EXCLUDE_DIRS_PYTHON);

    const result = spawnSync("vulture", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: MAX_OUTPUT_BUFFER,
    });

    // Vulture exits 1 when findings exist (not an error), 3 for syntax errors
    if (result.status !== null && result.status > 1 && result.status !== 3) {
      console.warn("  Vulture exited with unexpected code:", result.status);
      return [];
    }

    const output = result.stdout || "";
    if (output.trim()) {
      return parseVultureOutput(output, rootPath);
    }
  } catch (error) {
    console.warn("vulture failed:", error);
  }

  return [];
}
