#!/usr/bin/env node

/**
 * vibeCop CLI
 *
 * Usage:
 *   vibecop analyze [options]
 *   vibecop detect [path]
 *
 * Examples:
 *   npx vibecop analyze
 *   npx vibecop analyze --root ./my-project --cadence weekly
 *   npx vibecop detect ./my-project
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(__dirname, "..", "scripts");

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
vibeCop - Cross-repo static analysis + GitHub issue generator

Usage:
  vibecop <command> [options]

Commands:
  analyze     Run static analysis on a repository
  detect      Detect repository profile (languages, tools)
  help        Show this help message

Options for 'analyze':
  --root <path>              Root path to analyze (default: current directory)
  --cadence <cadence>        Analysis cadence: daily, weekly, monthly (default: weekly)
  --config <path>            Path to vibecop.yml config file
  --output <path>            Output directory for results
  --skip-issues              Skip GitHub issue creation
  --severity-threshold <s>   Min severity: critical, high, medium, low, info
  --confidence-threshold <c> Min confidence: high, medium, low
  --merge-strategy <s>       How to merge findings: none, same-file, same-rule, same-linter, same-tool

Environment Variables:
  GITHUB_TOKEN               Required for issue creation
  GITHUB_REPOSITORY          Repository in owner/repo format

Examples:
  # Analyze current directory
  vibecop analyze

  # Analyze a specific project
  vibecop analyze --root ./my-project --cadence weekly

  # Dry run (no issues created)
  vibecop analyze --skip-issues

  # Detect repo profile only
  vibecop detect ./my-project

Documentation: https://github.com/WolffM/vibecop
`);
}

function runScript(scriptName, scriptArgs = []) {
  const scriptPath = join(scriptsDir, scriptName);

  const child = spawn("node", ["--import", "tsx", scriptPath, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("close", (code) => {
    process.exit(code || 0);
  });

  child.on("error", (err) => {
    console.error(`Failed to run ${scriptName}:`, err.message);
    process.exit(1);
  });
}

// Route commands
switch (command) {
  case "analyze":
    runScript("analyze.ts", args.slice(1));
    break;

  case "detect":
    runScript("repo-detect.ts", args.slice(1));
    break;

  case "help":
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "vibecop help" for usage information.');
    process.exit(1);
}
