/**
 * Tool Runners
 *
 * Individual tool runner implementations for static analysis tools.
 * Each runner returns Finding[] and handles tool-specific execution details.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "../core/types.js";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  EXCLUDE_DIRS_COMMON,
  EXCLUDE_DIRS_PYTHON,
  extractJsonFromMixedOutput,
  findConfigFile,
  findSourceDirs,
  isToolAvailable,
  runTool,
  safeParseJson,
} from "./tool-utils.js";
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
  type DepcruiseOutput,
  type KnipOutput,
  type BanditOutput,
  type PmdOutput,
  type SpotBugsSarifOutput,
} from "../parsers.js";

// ============================================================================
// TypeScript / JavaScript Tools
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

/**
 * Run TypeScript type checking.
 */
export function runTsc(rootPath: string): Finding[] {
  console.log("Running TypeScript check...");
  const allFindings: Finding[] = [];

  try {
    // Check main project
    const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
    });

    // tsc exits with error code when there are type errors
    const output = result.stdout + result.stderr;
    const diagnostics = parseTscTextOutput(output);
    allFindings.push(...parseTscOutput(diagnostics));

    // Also check test-fixtures if it has its own tsconfig
    const testFixturesDir = join(rootPath, "test-fixtures");
    const testFixturesConfig = join(testFixturesDir, "tsconfig.json");
    if (existsSync(testFixturesConfig)) {
      console.log("  Also checking test-fixtures...");
      // Run from vibeCheck action's directory (parent of src/tools/) to use its TypeScript
      const vibeCheckRoot = join(__dirname, "../..");
      const fixturesResult = spawnSync(
        "npx",
        ["tsc", "--project", testFixturesConfig, "--noEmit", "--pretty", "false"],
        {
          cwd: vibeCheckRoot,
          encoding: "utf-8",
          shell: true,
        },
      );
      const fixturesOutput = fixturesResult.stdout + fixturesResult.stderr;
      const fixturesDiagnostics = parseTscTextOutput(fixturesOutput);
      console.log(`  Found ${fixturesDiagnostics.length} TypeScript errors in test-fixtures`);
      allFindings.push(...parseTscOutput(fixturesDiagnostics));
    }
  } catch (error) {
    console.warn("TypeScript check failed:", error);
  }

  return allFindings;
}

/**
 * Run jscpd (copy-paste detector).
 */
export function runJscpd(rootPath: string, minTokens: number = 70): Finding[] {
  console.log(`Running jscpd (min-tokens: ${minTokens})...`);

  try {
    const outputDir = join(rootPath, ".vibecheck-output");
    const outputPath = join(outputDir, "jscpd-report.json");

    // Files/patterns that commonly have legitimate duplicate content
    const ignorePatterns = [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/.vibecheck-output/**",
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
 */
export function runDependencyCruiser(
  rootPath: string,
  configPath?: string,
): Finding[] {
  console.log("Running dependency-cruiser...");

  try {
    const { available, useNpx } = isToolAvailable("depcruise");
    if (!available) {
      console.log("  dependency-cruiser not installed, skipping");
      return [];
    }

    // Determine source directories to scan
    const srcDirs = findSourceDirs(rootPath, [
      "src",
      "lib",
      "app",
      "scripts",
      "packages",
      "test-fixtures",
    ]);
    if (srcDirs.length === 0) {
      console.log(
        "  No source directories found (src, lib, app, scripts, packages)",
      );
      return [];
    }

    // Check for config file
    const config =
      configPath ||
      findConfigFile(rootPath, [
        ".dependency-cruiser.cjs",
        ".dependency-cruiser.js",
      ]);
    const args = [...srcDirs, "--output-type", "json"];

    if (config) {
      args.push("--config", config);
      console.log(`  Using config: ${config}`);
    } else {
      // Run with built-in cycle detection (no custom config needed)
      args.push("--no-config", "--validate", "true");
      console.log("  Running with built-in cycle detection (no config file)");
    }

    const result = runTool("depcruise", args, { cwd: rootPath, useNpx });

    // dependency-cruiser outputs JSON to stdout even with violations
    const output = result.stdout || "";
    const parsed = safeParseJson<DepcruiseOutput>(output);
    if (parsed) {
      const findings = parseDepcruiseOutput(parsed);
      console.log(`  Found ${findings.length} findings`);
      return findings;
    } else if (result.stderr) {
      console.log(`  stderr: ${result.stderr.substring(0, 200)}`);
    }
  } catch (error) {
    console.warn("dependency-cruiser failed:", error);
  }

  return [];
}

/**
 * Run knip for unused exports and dead code detection.
 */
export function runKnip(rootPath: string, configPath?: string): Finding[] {
  console.log("Running knip...");

  try {
    const { available, useNpx } = isToolAvailable("knip");
    if (!available) {
      console.log("  knip not installed, skipping");
      return [];
    }

    const args = ["--reporter", "json"];

    // Check for config file (optional)
    const config =
      configPath ||
      findConfigFile(rootPath, [
        "knip.json",
        "knip.jsonc",
        "knip.ts",
        ".knip.json",
        ".knip.jsonc",
      ]);

    if (config) {
      args.push("--config", config);
      console.log(`  Using config: ${config}`);
    } else {
      console.log("  Running with auto-detection (no config file)");
    }

    const result = runTool("knip", args, { cwd: rootPath, useNpx });

    // knip outputs JSON to stdout, exits with code 1 if issues found
    const output = result.stdout || "";
    const stderr = result.stderr || "";

    // Check for known non-fatal errors (e.g., missing ESLint dependencies)
    // These don't prevent knip from running, just from analyzing ESLint config
    if (stderr.includes("Error loading") && stderr.includes("eslint.config")) {
      console.log(
        "  Note: ESLint config loading failed (missing dependencies in target repo)",
      );
      console.log("  Knip will still analyze other aspects of the codebase");
    }

    const parsed = safeParseJson<KnipOutput>(output);
    if (parsed) {
      const findings = parseKnipOutput(parsed);
      console.log(`  Found ${findings.length} findings`);
      return findings;
    } else if (stderr && !stderr.includes("Error loading")) {
      // Only log stderr if it's not the known ESLint loading issue
      console.log(`  stderr: ${stderr.substring(0, 200)}`);
    }
  } catch (error) {
    console.warn("knip failed:", error);
  }

  return [];
}

// ============================================================================
// Security Tools
// ============================================================================

/**
 * Run Semgrep for security vulnerability detection.
 */
export function runSemgrep(rootPath: string, configPath?: string): Finding[] {
  console.log("Running semgrep...");

  try {
    const { available } = isToolAvailable("semgrep", false); // semgrep is Python-based, no npx
    if (!available) {
      console.log("  Semgrep not installed, skipping");
      return [];
    }

    // Use security-audit ruleset by default (works better than 'auto' on Windows)
    const config = configPath || "p/security-audit";
    const args = [
      "scan",
      "--json",
      "--config",
      config,
      "--exclude",
      EXCLUDE_DIRS_COMMON,
      ".",
    ];

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
// Python Tools
// ============================================================================

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

    const args = ["check", "--output-format", "json", "--exclude", EXCLUDE_DIRS_COMMON];
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
        const parsed = JSON.parse(output);
        return parseRuffOutput(parsed);
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
      maxBuffer: 50 * 1024 * 1024,
    });

    // Bandit outputs JSON to stdout
    const output = result.stdout || "";
    const parsed = safeParseJson<BanditOutput>(output);
    if (parsed) {
      return parseBanditOutput(parsed);
    }
  } catch (error) {
    console.warn("bandit failed:", error);
  }

  return [];
}

// ============================================================================
// Java Tools
// ============================================================================

/**
 * Run PMD static analyzer for Java code.
 */
export function runPmd(rootPath: string, configPath?: string): Finding[] {
  console.log("Running PMD...");

  try {
    const { available } = isToolAvailable("pmd", false);
    if (!available) {
      console.log("  PMD not installed, skipping");
      return [];
    }

    // Use quickstart ruleset if no config provided
    const rulesets = configPath || "rulesets/java/quickstart.xml";
    // PMD 7.x requires a file for --ignore-list, so we use glob patterns instead
    // to exclude common directories from scanning
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
    const parsed = safeParseJson<PmdOutput>(output);
    if (parsed) {
      return parsePmdOutput(parsed);
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
export function runSpotBugs(rootPath: string, configPath?: string): Finding[] {
  console.log("Running SpotBugs...");

  try {
    // Check if compiled classes exist (standard locations + test-fixtures)
    const targetClasses = join(rootPath, "target", "classes");
    const buildClasses = join(rootPath, "build", "classes");
    const testFixturesClasses = join(
      rootPath,
      "test-fixtures",
      "target",
      "classes",
    );

    let classesDir: string | null = null;
    if (existsSync(targetClasses)) {
      classesDir = targetClasses;
    } else if (existsSync(buildClasses)) {
      classesDir = buildClasses;
    } else if (existsSync(testFixturesClasses)) {
      classesDir = testFixturesClasses;
    }

    if (!classesDir) {
      console.log(
        "  No compiled classes found (target/classes, build/classes, or test-fixtures/target/classes), skipping",
      );
      return [];
    }

    const { available } = isToolAvailable("spotbugs", false);
    if (!available) {
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
      const parsed = safeParseJson<SpotBugsSarifOutput>(output);
      if (parsed) {
        return parseSpotBugsOutput(parsed);
      }
    }
  } catch (error) {
    console.warn("SpotBugs failed:", error);
  }

  return [];
}
