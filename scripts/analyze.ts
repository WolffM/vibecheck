/**
 * Main Analysis Orchestrator
 *
 * Coordinates the full analysis pipeline: tool execution, parsing,
 * SARIF/LLM JSON generation, and issue creation.
 *
 * Reference: vibeCop_spec.md section 9
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { detectRepo } from "./repo-detect.js";
import {
  parseTscTextOutput,
  parseTscOutput,
  parseJscpdOutput,
  parseTrunkOutput,
  parseDepcruiseOutput,
  parseKnipOutput,
  parseSemgrepOutput,
  parseRuffOutput,
  parseMypyOutput,
  parseBanditOutput,
  parsePmdOutput,
  parseSpotBugsOutput,
} from "./parsers.js";
import { buildSarifLog, writeSarifFile } from "./build-sarif.js";
import {
  buildLlmJson,
  writeLlmJsonFile,
  type FindingStats,
} from "./build-llm-json.js";
import { processFindings } from "./sarif-to-issues.js";
import {
  deduplicateFindings,
  mergeIssues,
  type MergeStrategy,
} from "./fingerprints.js";
import type {
  Cadence,
  Confidence,
  Finding,
  RepoProfile,
  RunContext,
  Severity,
  VibeCopConfig,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Validate severity threshold value.
 */
function isValidSeverityThreshold(value: string): value is Severity | "info" {
  return ["info", "low", "medium", "high", "critical"].includes(value);
}

/**
 * Validate confidence threshold value.
 */
function isValidConfidenceThreshold(value: string): value is Confidence {
  return ["low", "medium", "high"].includes(value);
}

/**
 * Load vibecop.yml config from repo root.
 */
function loadVibeCopConfig(
  rootPath: string,
  configPath: string = "vibecop",
): VibeCopConfig {
  // Try JSON first, then YAML
  const baseName = configPath.replace(/\.(json|yml|yaml)$/, "");
  const jsonPath = join(rootPath, `${baseName}.json`);
  const ymlPath = join(rootPath, `${baseName}.yml`);

  // Try JSON config first
  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, "utf-8");
      console.log(`Loaded config from ${jsonPath}`);
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to parse JSON config: ${error}`);
    }
  }

  // Try YAML config
  if (existsSync(ymlPath)) {
    try {
      const content = readFileSync(ymlPath, "utf-8");
      console.log(`Config file found at ${ymlPath}`);
      return parseSimpleYaml(content);
    } catch (error) {
      console.warn(`Failed to parse YAML config: ${error}`);
    }
  }

  console.log(
    `No config file found at ${jsonPath} or ${ymlPath}, using defaults`,
  );
  return { version: 1 };
}

/**
 * Very basic YAML parser for vibecop.yml structure.
 * For production, use the 'yaml' npm package.
 */
function parseSimpleYaml(content: string): VibeCopConfig {
  // This is a simplified parser - for production use a real YAML library
  const config: VibeCopConfig = { version: 1 };

  try {
    // Remove comments and parse as basic key-value
    // For MVP, just return defaults - config parsing would need yaml package
    const _lines = content.split("\n").filter((l) => !l.trim().startsWith("#"));
    console.log(
      "Note: Full YAML parsing requires yaml package. Using defaults.",
    );
    void _lines; // TODO: implement proper YAML parsing
  } catch {
    // Fallback to defaults
  }

  return config;
}

/**
 * Determine if a tool should run based on config and cadence.
 */
function shouldRunTool(
  enabled: boolean | "auto" | Cadence | undefined,
  _profile: RepoProfile,
  currentCadence: Cadence,
  toolDetector: () => boolean,
): boolean {
  if (enabled === false) return false;
  if (enabled === true) return true;

  // Cadence-based enablement
  if (enabled === "daily" || enabled === "weekly" || enabled === "monthly") {
    const cadenceOrder = { daily: 0, weekly: 1, monthly: 2 };
    return cadenceOrder[currentCadence] >= cadenceOrder[enabled];
  }

  // Auto-detect
  if (enabled === "auto" || enabled === undefined) {
    return toolDetector();
  }

  return false;
}

// ============================================================================
// Tool Runners
// ============================================================================

/**
 * Run Trunk check and capture output.
 */
function runTrunk(rootPath: string, args: string[] = ["check"]): Finding[] {
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
          timeout: 120000, // 2 minute timeout for init
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
        maxBuffer: 50 * 1024 * 1024, // 50MB
      },
    );

    // Trunk outputs JSON but may include ANSI codes, extract JSON portion
    const output = trunkResult.stdout || "";
    const stderr = trunkResult.stderr || "";

    console.log(`  Trunk exit code: ${trunkResult.status}`);
    console.log(`  Trunk cwd: ${rootPath}`);
    if (stderr && stderr.length < 500) {
      console.log(`  Trunk stderr: ${stderr}`);
    }

    // Strip ANSI codes before parsing
    const cleanOutput = output.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");

    // Try to find JSON object in output (could start anywhere)
    const jsonMatch = cleanOutput.match(/\{[\s\S]*"issues"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const trunkOutput = JSON.parse(jsonMatch[0]);
        const findings = parseTrunkOutput(trunkOutput);
        console.log(`  Parsed ${findings.length} findings from trunk JSON`);
        return findings;
      } catch (e) {
        console.warn("Failed to parse Trunk JSON output:", e);
        console.log("JSON match start:", jsonMatch[0].substring(0, 200));
      }
    } else {
      console.log("  No JSON found in trunk output");
      if (cleanOutput.length < 1000) {
        console.log("  Clean output:", cleanOutput);
      } else {
        console.log("  Output length:", cleanOutput.length);
        // Print first and last 200 chars to see format
        console.log("  First 200:", cleanOutput.substring(0, 200));
        console.log(
          "  Last 200:",
          cleanOutput.substring(cleanOutput.length - 200),
        );
      }
    }

    if (trunkResult.stderr) {
      console.log("Trunk stderr:", trunkResult.stderr.substring(0, 500));
    }
  } catch (error) {
    console.warn("Trunk not available or failed:", error);
  }

  return [];
}

/**
 * Run TypeScript type checking.
 */
function runTsc(rootPath: string): Finding[] {
  console.log("Running TypeScript check...");

  try {
    const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
    });

    // tsc exits with error code when there are type errors
    const output = result.stdout + result.stderr;
    const diagnostics = parseTscTextOutput(output);
    return parseTscOutput(diagnostics);
  } catch (error) {
    console.warn("TypeScript check failed:", error);
  }

  return [];
}

// NOTE: ESLint is handled by Trunk, so runEslint has been removed
// to avoid duplicate findings. Trunk runs ESLint internally.

/**
 * Run jscpd (copy-paste detector).
 */
function runJscpd(rootPath: string, minTokens: number = 70): Finding[] {
  console.log(`Running jscpd (min-tokens: ${minTokens})...`);

  try {
    const outputDir = join(rootPath, ".vibecop-output");
    const outputPath = join(outputDir, "jscpd-report.json");

    // Files/patterns that commonly have legitimate duplicate content
    const ignorePatterns = [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/.vibecop-output/**",
      "**/.trunk/**",
      // Lock files - always have duplicate structure
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/Gemfile.lock",
      "**/Cargo.lock",
      "**/poetry.lock",
      "**/composer.lock",
      // Generated/minified files
      "**/*.min.js",
      "**/*.min.css",
      "**/vendor/**",
      // Test snapshots
      "**/__snapshots__/**",
      "**/*.snap",
    ];

    // Run jscpd - we don't need the result, just the output file
    spawnSync(
      "npx",
      [
        "jscpd",
        ".",
        `--min-tokens=${minTokens}`,
        "--min-lines=5",
        "--reporters=json",
        `--output=${outputDir}`,
        `--ignore="${ignorePatterns.join(",")}"`,
      ],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
      },
    );

    if (existsSync(outputPath)) {
      const output = JSON.parse(readFileSync(outputPath, "utf-8"));
      const findings = parseJscpdOutput(output);
      console.log(`  Found ${findings.length} findings`);
      return findings;
    }
  } catch (error) {
    console.warn("jscpd failed:", error);
  }

  return [];
}

/**
 * Run dependency-cruiser for circular dependencies and architecture violations.
 * Runs with --no-config if no config file exists (uses built-in rules for cycles).
 */
function runDependencyCruiser(
  rootPath: string,
  configPath?: string,
): Finding[] {
  console.log("Running dependency-cruiser...");

  try {
    // Check if dependency-cruiser is available (globally installed or via npx)
    const versionCheck = spawnSync("depcruise", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      // Try npx as fallback
      const npxCheck = spawnSync("npx", ["depcruise", "--version"], {
        encoding: "utf-8",
        shell: true,
      });
      if (npxCheck.error || npxCheck.status !== 0) {
        console.log("  dependency-cruiser not installed, skipping");
        return [];
      }
    }

    // Determine source directories to scan
    const srcDirs: string[] = [];
    const commonDirs = [
      "src",
      "lib",
      "app",
      "scripts",
      "packages",
      "test-fixtures",
    ];
    for (const dir of commonDirs) {
      if (existsSync(join(rootPath, dir))) {
        srcDirs.push(dir);
      }
    }

    if (srcDirs.length === 0) {
      console.log(
        "  No source directories found (src, lib, app, scripts, packages)",
      );
      return [];
    }

    // Check for config file
    const config = configPath || ".dependency-cruiser.cjs";
    const fullConfigPath = join(rootPath, config);
    const hasConfig = existsSync(fullConfigPath);

    // Build args - use --no-config with --validate for cycle detection if no config
    const args = [...srcDirs, "--output-type", "json"];

    if (hasConfig) {
      args.push("--config", config);
      console.log(`  Using config: ${config}`);
    } else {
      // Run with built-in cycle detection (no custom config needed)
      args.push("--no-config", "--validate", "true");
      console.log("  Running with built-in cycle detection (no config file)");
    }

    // Try global install first, fall back to npx
    let result = spawnSync("depcruise", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    // If global command failed, try npx
    if (result.error || (result.status !== 0 && !result.stdout)) {
      result = spawnSync("npx", ["depcruise", ...args], {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 50 * 1024 * 1024,
      });
    }

    // dependency-cruiser outputs JSON to stdout even with violations
    const output = result.stdout;
    if (output && output.trim().startsWith("{")) {
      try {
        const depcruiseOutput = JSON.parse(output);
        const findings = parseDepcruiseOutput(depcruiseOutput);
        console.log(`  Found ${findings.length} findings`);
        return findings;
      } catch (e) {
        console.warn("Failed to parse dependency-cruiser JSON output:", e);
      }
    } else if (result.stderr) {
      // Log first part of stderr for debugging
      console.log(`  stderr: ${result.stderr.substring(0, 200)}`);
    }
  } catch (error) {
    console.warn("dependency-cruiser failed:", error);
  }

  return [];
}

/**
 * Run knip for unused exports and dead code detection.
 * Knip auto-detects project structure - no config file required.
 */
function runKnip(rootPath: string, configPath?: string): Finding[] {
  console.log("Running knip...");

  try {
    // Check if knip is available (globally installed or via npx)
    const versionCheck = spawnSync("knip", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      // Try npx as fallback
      const npxCheck = spawnSync("npx", ["knip", "--version"], {
        encoding: "utf-8",
        shell: true,
      });
      if (npxCheck.error || npxCheck.status !== 0) {
        console.log("  knip not installed, skipping");
        return [];
      }
    }

    // Build args - knip auto-detects project structure without config
    const args = ["--reporter", "json"];

    // Check for config file (optional)
    const config = configPath || "knip.json";
    const fullConfigPath = join(rootPath, config);
    const hasConfig = existsSync(fullConfigPath);

    if (hasConfig) {
      args.push("--config", config);
      console.log(`  Using config: ${config}`);
    } else {
      // Try alternative config locations
      const altConfigs = ["knip.jsonc", "knip.ts", ".knip.json", ".knip.jsonc"];
      const foundAlt = altConfigs.find((c) => existsSync(join(rootPath, c)));
      if (foundAlt) {
        args.push("--config", foundAlt);
        console.log(`  Using config: ${foundAlt}`);
      } else {
        console.log("  Running with auto-detection (no config file)");
      }
    }

    // Try global install first, fall back to npx
    let result = spawnSync("knip", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    // If global command failed, try npx
    if (result.error || (result.status !== 0 && !result.stdout)) {
      result = spawnSync("npx", ["knip", ...args], {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 50 * 1024 * 1024,
      });
    }

    // knip outputs JSON to stdout, exits with code 1 if issues found
    const output = result.stdout;
    if (output && output.trim().startsWith("{")) {
      try {
        const knipOutput = JSON.parse(output);
        const findings = parseKnipOutput(knipOutput);
        console.log(`  Found ${findings.length} findings`);
        return findings;
      } catch (e) {
        console.warn("Failed to parse knip JSON output:", e);
      }
    } else if (result.stderr) {
      // Log first part of stderr for debugging
      console.log(`  stderr: ${result.stderr.substring(0, 200)}`);
    }
  } catch (error) {
    console.warn("knip failed:", error);
  }

  return [];
}

/**
 * Run Semgrep for security vulnerability detection.
 * Uses p/security-audit ruleset by default (works better cross-platform than 'auto').
 */
function runSemgrep(rootPath: string, configPath?: string): Finding[] {
  console.log("Running semgrep...");

  try {
    // Check if semgrep is available
    const versionCheck = spawnSync("semgrep", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      console.log("  Semgrep not installed, skipping");
      return [];
    }

    // Use security-audit ruleset by default (works better than 'auto' on Windows)
    const config = configPath || "p/security-audit";
    const args = ["scan", "--json", "--config", config, "."];

    const result = spawnSync("semgrep", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    // Semgrep outputs JSON mixed with progress info, extract JSON portion
    const output = result.stdout || "";
    const jsonMatch = output.match(/\{[\s\S]*"version"[\s\S]*\}(?=\s*$)/);
    if (jsonMatch) {
      try {
        const semgrepOutput = JSON.parse(jsonMatch[0]);
        return parseSemgrepOutput(semgrepOutput);
      } catch (e) {
        console.warn("Failed to parse semgrep JSON output:", e);
      }
    }

    // Handle known Windows encoding issues gracefully
    if (result.stderr && result.stderr.includes("charmap")) {
      console.log(
        "  Semgrep has encoding issues, try: semgrep scan --config p/security-audit .",
      );
      return [];
    }
  } catch (error) {
    console.warn("semgrep failed:", error);
  }

  return [];
}

// ============================================================================
// Python Tool Runners
// ============================================================================

/**
 * Run Ruff linter for Python code.
 */
function runRuff(rootPath: string, configPath?: string): Finding[] {
  console.log("Running ruff...");

  try {
    // Check if ruff is available
    const versionCheck = spawnSync("ruff", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      console.log("  Ruff not installed, skipping");
      return [];
    }

    const args = ["check", "--output-format", "json"];
    if (configPath) {
      args.push("--config", configPath);
    }
    args.push(".");

    const result = spawnSync("ruff", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    // Ruff outputs JSON array to stdout
    const output = result.stdout || "";
    if (output.trim().startsWith("[")) {
      try {
        const ruffOutput = JSON.parse(output);
        return parseRuffOutput(ruffOutput);
      } catch (e) {
        console.warn("Failed to parse ruff JSON output:", e);
      }
    }
  } catch (error) {
    console.warn("ruff failed:", error);
  }

  return [];
}

/**
 * Run Mypy type checker for Python code.
 */
function runMypy(rootPath: string, configPath?: string): Finding[] {
  console.log("Running mypy...");

  try {
    // Check if mypy is available
    const versionCheck = spawnSync("mypy", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      console.log("  Mypy not installed, skipping");
      return [];
    }

    // Use --output=json for native JSON output (Python 3.10+)
    const args = ["--output", "json"];
    if (configPath) {
      args.push("--config-file", configPath);
    }
    args.push(".");

    const result = spawnSync("mypy", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
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
      return parseMypyOutput(errors);
    }
  } catch (error) {
    console.warn("mypy failed:", error);
  }

  return [];
}

/**
 * Run Bandit security scanner for Python code.
 */
function runBandit(rootPath: string, configPath?: string): Finding[] {
  console.log("Running bandit...");

  try {
    // Check if bandit is available
    const versionCheck = spawnSync("bandit", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      console.log("  Bandit not installed, skipping");
      return [];
    }

    const args = ["-f", "json", "-r", "."];
    if (configPath) {
      args.push("-c", configPath);
    }

    const result = spawnSync("bandit", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    // Bandit outputs JSON to stdout
    const output = result.stdout || "";
    if (output.trim().startsWith("{")) {
      try {
        const banditOutput = JSON.parse(output);
        return parseBanditOutput(banditOutput);
      } catch (e) {
        console.warn("Failed to parse bandit JSON output:", e);
      }
    }
  } catch (error) {
    console.warn("bandit failed:", error);
  }

  return [];
}

// ============================================================================
// Java Tool Runners
// ============================================================================

/**
 * Run PMD static analyzer for Java code.
 */
function runPmd(rootPath: string, configPath?: string): Finding[] {
  console.log("Running PMD...");

  try {
    // Check if pmd is available (could be 'pmd' or installed via path)
    const versionCheck = spawnSync("pmd", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      console.log("  PMD not installed, skipping");
      return [];
    }

    // Use quickstart ruleset if no config provided
    const rulesets = configPath || "rulesets/java/quickstart.xml";
    const args = [
      "check",
      "-d",
      ".",
      "-R",
      rulesets,
      "-f",
      "json",
      "--no-progress",
    ];

    const result = spawnSync("pmd", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    // PMD outputs JSON to stdout
    const output = result.stdout || "";
    if (output.trim().startsWith("{")) {
      try {
        const pmdOutput = JSON.parse(output);
        return parsePmdOutput(pmdOutput);
      } catch (e) {
        console.warn("Failed to parse PMD JSON output:", e);
      }
    }
  } catch (error) {
    console.warn("PMD failed:", error);
  }

  return [];
}

/**
 * Run SpotBugs bytecode analyzer for Java code.
 * Note: SpotBugs requires compiled .class files.
 */
function runSpotBugs(rootPath: string, configPath?: string): Finding[] {
  console.log("Running SpotBugs...");

  try {
    // Check if compiled classes exist
    const targetClasses = join(rootPath, "target", "classes");
    const buildClasses = join(rootPath, "build", "classes");

    if (!existsSync(targetClasses) && !existsSync(buildClasses)) {
      console.log(
        "  No compiled classes found (target/classes or build/classes), skipping",
      );
      return [];
    }

    const classesDir = existsSync(targetClasses) ? targetClasses : buildClasses;

    // Check if spotbugs is available
    const versionCheck = spawnSync("spotbugs", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      console.log("  SpotBugs not installed, skipping");
      return [];
    }

    const args = ["-sarif", classesDir];
    if (configPath) {
      args.unshift("-exclude", configPath);
    }

    const result = spawnSync("spotbugs", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    // SpotBugs outputs SARIF to stdout when using -sarif
    const output = result.stdout || "";
    if (output.includes('"$schema"') && output.includes('"runs"')) {
      try {
        const spotbugsOutput = JSON.parse(output);
        return parseSpotBugsOutput(spotbugsOutput);
      } catch (e) {
        console.warn("Failed to parse SpotBugs SARIF output:", e);
      }
    }
  } catch (error) {
    console.warn("SpotBugs failed:", error);
  }

  return [];
}

// ============================================================================
// Main Analysis Pipeline
// ============================================================================

export interface AnalyzeOptions {
  rootPath?: string;
  configPath?: string;
  cadence?: Cadence;
  outputDir?: string;
  skipIssues?: boolean;
  severityThreshold?: Severity | "info";
  confidenceThreshold?: Confidence;
  mergeStrategy?: MergeStrategy;
}

export interface AnalyzeResult {
  findings: Finding[];
  profile: RepoProfile;
  context: RunContext;
  stats: {
    totalFindings: number;
    uniqueFindings: number;
    mergedFindings: number;
    byTool: Record<string, number>;
  };
}

/**
 * Run the full analysis pipeline.
 */
export async function analyze(
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const rootPath = options.rootPath || process.cwd();
  const configPath = options.configPath || "vibecop.yml";
  const cadence = options.cadence || "weekly";
  const severityThreshold = options.severityThreshold || "info";
  const confidenceThreshold = options.confidenceThreshold || "low";
  const mergeStrategy = options.mergeStrategy || "same-rule";
  const outputDir = options.outputDir || join(rootPath, ".vibecop-output");

  // Validate threshold values
  if (!isValidSeverityThreshold(severityThreshold)) {
    throw new Error(
      `Invalid severity threshold: "${severityThreshold}". Must be one of: info, low, medium, high, critical`,
    );
  }
  if (!isValidConfidenceThreshold(confidenceThreshold)) {
    throw new Error(
      `Invalid confidence threshold: "${confidenceThreshold}". Must be one of: low, medium, high`,
    );
  }

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log("=== vibeCop Analysis ===");
  console.log(`Root: ${rootPath}`);
  console.log(`Cadence: ${cadence}`);
  console.log("");

  // Step 1: Detect repo profile
  console.log("Step 1: Detecting repository profile...");
  const profile = await detectRepo(rootPath);
  console.log(`  Languages: ${profile.languages.join(", ")}`);
  console.log(`  Package manager: ${profile.packageManager}`);
  console.log(`  Monorepo: ${profile.isMonorepo}`);
  console.log("");

  // Step 2: Load configuration
  console.log("Step 2: Loading configuration...");
  const config = loadVibeCopConfig(rootPath, configPath);
  console.log("");

  // Step 3: Run analysis tools
  console.log("Step 3: Running analysis tools...");
  const allFindings: Finding[] = [];

  // Trunk (if available)
  if (config.trunk?.enabled !== false) {
    const trunkFindings = runTrunk(
      rootPath,
      (config.trunk?.arguments || "check --all").split(" "),
    );
    allFindings.push(...trunkFindings);
    console.log(`  Trunk: ${trunkFindings.length} findings`);
  }

  // TypeScript
  if (
    shouldRunTool(
      config.tools?.tsc?.enabled,
      profile,
      cadence,
      () => profile.hasTypeScript,
    )
  ) {
    const tscFindings = runTsc(rootPath);
    allFindings.push(...tscFindings);
    console.log(`  TypeScript: ${tscFindings.length} findings`);
  }

  // NOTE: ESLint is handled by Trunk, so we don't run it separately
  // to avoid duplicate findings. If you need standalone ESLint,
  // configure it in your vibecop.yml with tools.eslint.enabled: true

  // jscpd (weekly/monthly)
  if (
    shouldRunTool(
      config.tools?.jscpd?.enabled || "weekly",
      profile,
      cadence,
      () => true,
    )
  ) {
    const jscpdFindings = runJscpd(rootPath, config.tools?.jscpd?.min_tokens);
    allFindings.push(...jscpdFindings);
    console.log(`  jscpd: ${jscpdFindings.length} findings`);
  }

  // dependency-cruiser (weekly) - runs for any JS/TS project, no config needed
  if (
    shouldRunTool(
      config.tools?.dependency_cruiser?.enabled || "weekly",
      profile,
      cadence,
      () => profile.hasTypeScript || profile.languages.includes("javascript"),
    )
  ) {
    const depcruiseFindings = runDependencyCruiser(
      rootPath,
      config.tools?.dependency_cruiser?.config_path,
    );
    allFindings.push(...depcruiseFindings);
    console.log(`  dependency-cruiser: ${depcruiseFindings.length} findings`);
  }

  // knip (weekly) - runs for any JS/TS project, auto-detects without config
  if (
    shouldRunTool(
      config.tools?.knip?.enabled || "weekly",
      profile,
      cadence,
      () => profile.hasTypeScript || profile.languages.includes("javascript"),
    )
  ) {
    const knipFindings = runKnip(rootPath, config.tools?.knip?.config_path);
    allFindings.push(...knipFindings);
    console.log(`  knip: ${knipFindings.length} findings`);
  }

  // semgrep (weekly/monthly for security scanning)
  if (
    shouldRunTool(
      config.tools?.semgrep?.enabled || "weekly",
      profile,
      cadence,
      () => true,
    )
  ) {
    const semgrepFindings = runSemgrep(rootPath, config.tools?.semgrep?.config);
    allFindings.push(...semgrepFindings);
    console.log(`  semgrep: ${semgrepFindings.length} findings`);
  }

  // Python tools (only if Python detected)
  if (profile.hasPython) {
    // Ruff (daily - fast linting)
    if (
      shouldRunTool(
        config.tools?.ruff?.enabled || "daily",
        profile,
        cadence,
        () => profile.hasPython,
      )
    ) {
      const ruffFindings = runRuff(rootPath, config.tools?.ruff?.config_path);
      allFindings.push(...ruffFindings);
      console.log(`  ruff: ${ruffFindings.length} findings`);
    }

    // Mypy (daily - type checking)
    if (
      shouldRunTool(
        config.tools?.mypy?.enabled || "daily",
        profile,
        cadence,
        () => profile.hasPython,
      )
    ) {
      const mypyFindings = runMypy(rootPath, config.tools?.mypy?.config_path);
      allFindings.push(...mypyFindings);
      console.log(`  mypy: ${mypyFindings.length} findings`);
    }

    // Bandit (weekly - security scanning)
    if (
      shouldRunTool(
        config.tools?.bandit?.enabled || "weekly",
        profile,
        cadence,
        () => profile.hasPython,
      )
    ) {
      const banditFindings = runBandit(
        rootPath,
        config.tools?.bandit?.config_path,
      );
      allFindings.push(...banditFindings);
      console.log(`  bandit: ${banditFindings.length} findings`);
    }
  }

  // Java tools (only if Java detected)
  if (profile.hasJava) {
    // PMD (weekly - code analysis)
    if (
      shouldRunTool(
        config.tools?.pmd?.enabled || "weekly",
        profile,
        cadence,
        () => profile.hasJava,
      )
    ) {
      const pmdFindings = runPmd(rootPath, config.tools?.pmd?.config_path);
      allFindings.push(...pmdFindings);
      console.log(`  PMD: ${pmdFindings.length} findings`);
    }

    // SpotBugs (monthly - bytecode analysis)
    if (
      shouldRunTool(
        config.tools?.spotbugs?.enabled || "monthly",
        profile,
        cadence,
        () => profile.hasJava,
      )
    ) {
      const spotbugsFindings = runSpotBugs(
        rootPath,
        config.tools?.spotbugs?.config_path,
      );
      allFindings.push(...spotbugsFindings);
      console.log(`  SpotBugs: ${spotbugsFindings.length} findings`);
    }
  }

  console.log("");

  // Step 4: Deduplicate findings
  console.log("Step 4: Deduplicating findings...");
  const uniqueFindings = deduplicateFindings(allFindings);
  console.log(
    `  Total: ${allFindings.length} -> Unique: ${uniqueFindings.length}`,
  );

  // Step 4b: Merge findings based on strategy
  console.log(`Step 4b: Merging findings (strategy: ${mergeStrategy})...`);
  const mergedFindings = mergeIssues(uniqueFindings, mergeStrategy);
  console.log(
    `  Unique: ${uniqueFindings.length} -> Merged: ${mergedFindings.length}`,
  );
  console.log("");

  // Merge CLI threshold options into config (CLI takes precedence)
  const mergedConfig: VibeCopConfig = {
    ...config,
    issues: {
      // DEFAULT_CONFIG.issues is always defined (non-null assertion is safe)
      ...DEFAULT_CONFIG.issues!,
      ...config.issues,
      severity_threshold: severityThreshold,
      confidence_threshold: confidenceThreshold,
    },
  };

  // Build context
  const context: RunContext = {
    repo: {
      owner: process.env.GITHUB_REPOSITORY_OWNER || "unknown",
      name: process.env.GITHUB_REPOSITORY?.split("/")[1] || "unknown",
      defaultBranch: "main",
      commit: process.env.GITHUB_SHA || "unknown",
    },
    profile,
    config: mergedConfig,
    cadence,
    runNumber: parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10),
    workspacePath: rootPath,
    outputDir,
  };

  // Step 5: Generate outputs
  console.log("Step 5: Generating outputs...");

  // Write all findings (before merge) for debugging
  const allFindingsPath = join(outputDir, "findings-all.json");
  writeFileSync(allFindingsPath, JSON.stringify(uniqueFindings, null, 2));
  console.log(`  All findings: ${allFindingsPath}`);

  // Write merged findings for issue creation
  const findingsPath = join(outputDir, "findings.json");
  writeFileSync(findingsPath, JSON.stringify(mergedFindings, null, 2));
  console.log(`  Merged findings: ${findingsPath}`);

  // Write context
  const contextPath = join(outputDir, "context.json");
  writeFileSync(contextPath, JSON.stringify(context, null, 2));
  console.log(`  Context: ${contextPath}`);

  // Build SARIF (use all unique findings for code scanning)
  if (config.output?.sarif !== false) {
    const sarif = buildSarifLog(uniqueFindings, context);
    const sarifPath = join(outputDir, "results.sarif");
    writeSarifFile(sarif, sarifPath);
    console.log(`  SARIF: ${sarifPath}`);
  }

  // Build LLM JSON (use merged findings for agent consumption)
  if (config.output?.llm_json !== false) {
    const findingStats: FindingStats = {
      totalFindings: allFindings.length,
      uniqueFindings: uniqueFindings.length,
      mergedFindings: mergedFindings.length,
    };
    const llmJson = buildLlmJson(mergedFindings, context, findingStats);
    const llmJsonPath = join(outputDir, "results.llm.json");
    writeLlmJsonFile(llmJson, llmJsonPath);
    console.log(`  LLM JSON: ${llmJsonPath}`);
  }

  console.log("");

  // Step 6: Create/update issues (use merged findings)
  let issueStats = { created: 0, updated: 0, closed: 0 };
  if (
    !options.skipIssues &&
    config.issues?.enabled !== false &&
    process.env.GITHUB_TOKEN
  ) {
    console.log("Step 6: Processing GitHub issues...");
    const stats = await processFindings(mergedFindings, context);
    issueStats = {
      created: stats.created,
      updated: stats.updated,
      closed: stats.closed,
    };
    console.log(`  Created: ${issueStats.created}`);
    console.log(`  Updated: ${issueStats.updated}`);
    console.log(`  Closed: ${issueStats.closed}`);

    // Update LLM JSON with issue stats
    if (config.output?.llm_json !== false) {
      const llmJsonPath = join(outputDir, "results.llm.json");
      const llmJsonContent = JSON.parse(readFileSync(llmJsonPath, "utf-8"));
      llmJsonContent.summary.issuesCreated = issueStats.created;
      llmJsonContent.summary.issuesUpdated = issueStats.updated;
      llmJsonContent.summary.issuesClosed = issueStats.closed;
      writeFileSync(llmJsonPath, JSON.stringify(llmJsonContent, null, 2));
      console.log(`  Updated LLM JSON with issue stats`);
    }
  } else {
    console.log("Step 6: Skipping GitHub issues (disabled or no token)");
  }

  console.log("");
  console.log("=== Analysis Complete ===");

  // Calculate stats
  const byTool: Record<string, number> = {};
  for (const finding of uniqueFindings) {
    byTool[finding.tool] = (byTool[finding.tool] || 0) + 1;
  }

  return {
    findings: mergedFindings,
    profile,
    context,
    stats: {
      totalFindings: allFindings.length,
      uniqueFindings: uniqueFindings.length,
      mergedFindings: mergedFindings.length,
      byTool,
    },
  };
}

// ============================================================================
// CLI Validation Helpers
// ============================================================================

/**
 * Validate and parse severity threshold from CLI input.
 * Throws an error if the value is invalid.
 */
function parseSeverityThreshold(value: string): Severity | "info" {
  const validValues: Array<Severity | "info"> = [
    "info",
    "low",
    "medium",
    "high",
    "critical",
  ];
  if (validValues.includes(value as Severity | "info")) {
    return value as Severity | "info";
  }
  throw new Error(
    `Invalid severity threshold: '${value}'. Must be one of: ${validValues.join(", ")}`,
  );
}

/**
 * Validate and parse confidence threshold from CLI input.
 * Throws an error if the value is invalid.
 */
function parseConfidenceThreshold(value: string): Confidence {
  const validValues: Confidence[] = ["low", "medium", "high"];
  if (validValues.includes(value as Confidence)) {
    return value as Confidence;
  }
  throw new Error(
    `Invalid confidence threshold: '${value}'. Must be one of: ${validValues.join(", ")}`,
  );
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  const options: AnalyzeOptions = {
    rootPath: process.cwd(),
    cadence: "weekly",
  };

  // Parse simple CLI args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" && args[i + 1]) {
      options.rootPath = args[++i];
    } else if (arg === "--cadence" && args[i + 1]) {
      options.cadence = args[++i] as Cadence;
    } else if (arg === "--config" && args[i + 1]) {
      options.configPath = args[++i];
    } else if (arg === "--output" && args[i + 1]) {
      options.outputDir = args[++i];
    } else if (arg === "--skip-issues") {
      options.skipIssues = true;
    } else if (arg === "--severity-threshold" && args[i + 1]) {
      options.severityThreshold = parseSeverityThreshold(args[++i]);
    } else if (arg === "--confidence-threshold" && args[i + 1]) {
      options.confidenceThreshold = parseConfidenceThreshold(args[++i]);
    } else if (arg === "--merge-strategy" && args[i + 1]) {
      options.mergeStrategy = args[++i] as MergeStrategy;
    }
  }

  try {
    const result = await analyze(options);

    // Exit with error code if there are high-severity findings
    const highSeverity = result.findings.filter(
      (f) => f.severity === "high" || f.severity === "critical",
    );
    if (highSeverity.length > 0) {
      console.log(
        `\n⚠️  Found ${highSeverity.length} high/critical severity findings`,
      );
      // Don't exit with error for scheduled runs - just report
    }
  } catch (error) {
    console.error("Analysis failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
