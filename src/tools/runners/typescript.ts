/**
 * TypeScript/JavaScript Tool Runners
 *
 * Runners for TypeScript/JavaScript analysis tools:
 * - tsc (TypeScript compiler)
 * - jscpd (copy-paste detector)
 * - dependency-cruiser (architecture)
 * - knip (dead code)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Finding } from "../../core/types.js";
import {
  findConfigFile,
  findSourceDirs,
  isToolAvailable,
  runTool,
  safeParseJson,
} from "../tool-utils.js";
import {
  parseTscTextOutput,
  parseTscOutput,
  parseJscpdOutput,
  parseDepcruiseOutput,
  parseKnipOutput,
  parseEslintOutput,
  type DepcruiseOutput,
  type KnipOutput,
  type EslintOutput,
} from "../../parsers.js";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      // Run from vibeCheck action's directory (parent of src/tools/runners/) to use its TypeScript
      const vibeCheckRoot = join(__dirname, "../../..");
      const fixturesResult = spawnSync(
        "npx",
        [
          "tsc",
          "--project",
          testFixturesConfig,
          "--noEmit",
          "--pretty",
          "false",
        ],
        {
          cwd: vibeCheckRoot,
          encoding: "utf-8",
          shell: true,
        },
      );
      const fixturesOutput = fixturesResult.stdout + fixturesResult.stderr;
      const fixturesDiagnostics = parseTscTextOutput(fixturesOutput);
      console.log(
        `  Found ${fixturesDiagnostics.length} TypeScript errors in test-fixtures`,
      );
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

    // Debug: log exit code and output length
    console.log(`  Exit code: ${result.status}, stdout: ${output.length} chars, stderr: ${stderr.length} chars`);

    // If exit code is 2, knip encountered an error - show the output for debugging
    if (result.status === 2) {
      console.log(`  Error - stdout: ${output.substring(0, 500)}`);
      console.log(`  Error - stderr: ${stderr.substring(0, 500)}`);
    }

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
      // Debug: log what knip found
      console.log(`  Raw knip output: files=${parsed.files?.length || 0}, issues=${parsed.issues?.length || 0}`);
      const findings = parseKnipOutput(parsed);
      console.log(`  Found ${findings.length} findings`);
      return findings;
    } else if (stderr && !stderr.includes("Error loading")) {
      // Only log stderr if it's not the known ESLint loading issue
      console.log(`  stderr: ${stderr.substring(0, 200)}`);
    } else if (!output.trim()) {
      console.log("  Warning: knip returned empty output");
    }
  } catch (error) {
    console.warn("knip failed:", error);
  }

  return [];
}

/**
 * Run ESLint for JavaScript/TypeScript linting.
 * Runs as a standalone tool (not through Trunk) to ensure config is loaded properly.
 */
export function runEslint(rootPath: string): Finding[] {
  console.log("Running ESLint...");

  try {
    // Check if ESLint is available
    const { available, useNpx } = isToolAvailable("eslint");
    if (!available) {
      console.log("  ESLint not installed, skipping");
      return [];
    }

    // Check for ESLint config
    const configFile = findConfigFile(rootPath, [
      "eslint.config.mjs",
      "eslint.config.js",
      "eslint.config.cjs",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      ".eslintrc.yml",
      ".eslintrc.yaml",
    ]);

    if (!configFile) {
      console.log("  No ESLint config found, skipping");
      return [];
    }

    console.log(`  Using config: ${configFile}`);

    // Find source directories to scan
    const srcDirs = findSourceDirs(rootPath, [
      "src",
      "lib",
      "app",
      "test-fixtures",
    ]);

    if (srcDirs.length === 0) {
      console.log("  No source directories found");
      return [];
    }

    // Run ESLint with JSON output
    const args = [
      ...srcDirs,
      "--format", "json",
      "--no-error-on-unmatched-pattern",
    ];

    const result = runTool("eslint", args, { cwd: rootPath, useNpx });

    // ESLint exits with code 1 when there are linting errors
    // The JSON output is in stdout regardless
    const output = result.stdout || "";

    if (!output.trim()) {
      console.log("  No output from ESLint");
      return [];
    }

    const parsed = safeParseJson<EslintOutput>(output);
    if (parsed) {
      const findings = parseEslintOutput(parsed);
      console.log(`  Found ${findings.length} findings`);
      return findings;
    } else {
      console.log("  Failed to parse ESLint output");
      if (result.stderr) {
        console.log(`  stderr: ${result.stderr.substring(0, 200)}`);
      }
    }
  } catch (error) {
    console.warn("ESLint failed:", error);
  }

  return [];
}
