#!/usr/bin/env npx tsx
/**
 * Autofix CLI Entry Point
 *
 * Standalone script for running autofixes from action.yml.
 * Reads findings from results.llm.json and runs appropriate fix commands.
 *
 * Usage:
 *   npx tsx src/tools/run-autofix.ts --results .vibecheck-output/results.llm.json --root /path/to/repo
 *
 * Output:
 *   JSON object with autofix results written to stdout (for action.yml to parse)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Finding } from "../core/types.js";
import { runAutofix } from "./autofix-runner.js";
import type { AutofixConfig } from "./autofix-registry.js";

// ============================================================================
// Types
// ============================================================================

interface LlmJsonOutput {
  findings: Finding[];
  [key: string]: unknown;
}

interface CliArgs {
  resultsPath: string;
  rootPath: string;
  configPath?: string;
  outputPath?: string;
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let resultsPath = "";
  let rootPath = process.cwd();
  let configPath: string | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--results":
      case "-r":
        resultsPath = args[++i];
        break;
      case "--root":
        rootPath = args[++i];
        break;
      case "--config":
      case "-c":
        configPath = args[++i];
        break;
      case "--output":
      case "-o":
        outputPath = args[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  if (!resultsPath) {
    console.error("Error: --results is required");
    printUsage();
    process.exit(1);
  }

  return { resultsPath, rootPath, configPath, outputPath };
}

function printUsage(): void {
  console.log(`
Usage: npx tsx src/tools/run-autofix.ts [options]

Options:
  --results, -r <path>  Path to results.llm.json (required)
  --root <path>         Repository root path (default: current directory)
  --config, -c <path>   Path to vibecheck.yml config (optional)
  --output, -o <path>   Path to write autofix results JSON (optional)
  --help, -h            Show this help message

Example:
  npx tsx src/tools/run-autofix.ts --results .vibecheck-output/results.llm.json --root /path/to/repo
`);
}

// ============================================================================
// Config Loading
// ============================================================================

function loadAutofixConfig(configPath?: string): AutofixConfig | undefined {
  if (!configPath) return undefined;

  try {
    // Simple YAML parsing for autofix section
    // For full YAML support, would need to import yaml parser
    const content = readFileSync(configPath, "utf-8");

    // Look for autofix section in YAML
    const autofixMatch = content.match(/^autofix:\s*\n((?:\s+.+\n)*)/m);
    if (!autofixMatch) return undefined;

    // Parse simple key-value pairs (basic YAML support)
    // For complex configs, should use proper YAML parser
    console.log("  Found autofix config section (basic parsing)");
    return undefined; // TODO: Implement full YAML parsing if needed
  } catch {
    return undefined;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  console.log("=== vibeCheck Autofix Runner ===\n");
  console.log(`Results: ${args.resultsPath}`);
  console.log(`Root: ${args.rootPath}`);

  // Load results - prefer unmerged findings for autofix (to avoid losing safe autofix level)
  const resultsPath = resolve(args.rootPath, args.resultsPath);
  const resultsDir = dirname(resultsPath);
  let findings: Finding[];

  // Try to load unmerged findings first (findings-all.json has all findings before merge)
  // This is important because merging uses conservative autofix (safe -> none if any none exists)
  const unmergedPath = resolve(resultsDir, "findings-all.json");
  const mergedPath = resolve(resultsDir, "findings.json");

  try {
    if (existsSync(unmergedPath)) {
      const content = readFileSync(unmergedPath, "utf-8");
      findings = JSON.parse(content);
      console.log(`Loaded ${findings.length} unmerged findings from findings-all.json`);
    } else if (existsSync(mergedPath)) {
      const content = readFileSync(mergedPath, "utf-8");
      findings = JSON.parse(content);
      console.log(`Loaded ${findings.length} findings from findings.json`);
    } else {
      // Fall back to results.llm.json
      const content = readFileSync(resultsPath, "utf-8");
      const results: LlmJsonOutput = JSON.parse(content);
      findings = results.findings || [];
      console.log(`Loaded ${findings.length} merged findings from results.llm.json`);
      console.log(`  Note: Using merged findings - some safe autofix may be lost`);
    }
    console.log("");
  } catch (error) {
    console.error(`Failed to load results: ${error}`);
    process.exit(1);
  }

  // Load optional config
  const userConfig = args.configPath
    ? loadAutofixConfig(resolve(args.rootPath, args.configPath))
    : undefined;

  // Run autofixes
  const summary = runAutofix(args.rootPath, findings, userConfig);

  // Output results
  const output = JSON.stringify(summary, null, 2);

  if (args.outputPath) {
    const outputPath = resolve(args.rootPath, args.outputPath);
    writeFileSync(outputPath, output);
    console.log(`\nResults written to: ${outputPath}`);
  }

  // Also write to a known location for action.yml to consume
  const defaultOutputPath = resolve(
    dirname(resultsPath),
    "autofix-results.json",
  );
  writeFileSync(defaultOutputPath, output);
  console.log(`Results written to: ${defaultOutputPath}`);

  // Exit with appropriate code
  if (summary.toolsFailed > 0 && summary.toolsSucceeded === 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("Autofix runner failed:", error);
  process.exit(1);
});
