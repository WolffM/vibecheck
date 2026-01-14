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
    // Check if this project has knip installed locally (check package.json)
    const packageJsonPath = join(rootPath, "package.json");
    let hasLocalKnip = false;

    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        hasLocalKnip = "knip" in allDeps;
      } catch {
        // Ignore parse errors
      }
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

    // Use pnpm exec if knip is a local dependency (handles pnpm's module resolution)
    // Otherwise fall back to npx which works for npm/yarn or when knip is not local
    let result;
    if (hasLocalKnip) {
      // Check if pnpm is available (pnpm-lock.yaml exists)
      const hasPnpm = existsSync(join(rootPath, "pnpm-lock.yaml"));
      if (hasPnpm) {
        // Set NODE_PATH to ensure knip can resolve modules from the target repo
        const nodeModulesPath = join(rootPath, "node_modules");
        const env = {
          ...process.env,
          NODE_PATH: nodeModulesPath,
        };
        result = spawnSync("pnpm", ["exec", "knip", ...args], {
          cwd: rootPath,
          encoding: "utf-8",
          shell: true,
          env,
        });
      } else {
        result = runTool("knip", args, { cwd: rootPath, useNpx: true });
      }
    } else {
      result = runTool("knip", args, { cwd: rootPath, useNpx: true });
    }

    // knip outputs JSON to stdout, exits with code 1 if issues found
    const output = result.stdout || "";
    const stderr = result.stderr || "";

    // Log error if knip crashed (exit code 2)
    if (result.status === 2) {
      console.log(`  knip error: ${stderr.substring(0, 200)}`);
    }

    const parsed = safeParseJson<KnipOutput>(output);
    if (parsed) {
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

    console.log(`  Scanning directories: ${srcDirs.join(", ")}`);

    // Run ESLint with JSON output
    const args = [
      ...srcDirs,
      "--format", "json",
      "--no-error-on-unmatched-pattern",
    ];

    // Check if ESLint is a local dependency - need to use pnpm exec to resolve config imports
    const packageJsonPath = join(rootPath, "package.json");
    let hasLocalEslint = false;
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        const allDeps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
        hasLocalEslint = "eslint" in allDeps;
      } catch {
        // Ignore parse errors
      }
    }

    let result;
    if (hasLocalEslint) {
      // Use pnpm exec for pnpm projects to properly resolve local dependencies
      const hasPnpm = existsSync(join(rootPath, "pnpm-lock.yaml"));
      if (hasPnpm) {
        console.log("  Using pnpm exec for local ESLint");
        result = spawnSync("pnpm", ["exec", "eslint", ...args], {
          cwd: rootPath,
          encoding: "utf-8",
          shell: true,
        });
      } else {
        // Try npx with local eslint
        result = runTool("eslint", args, { cwd: rootPath, useNpx: true });
      }
    } else {
      // Fall back to global/npx eslint
      const { available, useNpx } = isToolAvailable("eslint");
      if (!available) {
        console.log("  ESLint not installed, skipping");
        return [];
      }
      result = runTool("eslint", args, { cwd: rootPath, useNpx });
    }

    // ESLint exits with code 1 when there are linting errors
    // The JSON output is in stdout regardless
    const output = result.stdout || "";

    if (!output.trim()) {
      console.log("  No output from ESLint");
      // Log stderr to help diagnose issues
      if (result.stderr) {
        console.log(`  stderr: ${result.stderr.substring(0, 500)}`);
      }
      if (result.status !== null && result.status !== 0 && result.status !== 1) {
        console.log(`  Exit code: ${result.status}`);
      }
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
