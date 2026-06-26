/**
 * Shared CLI utilities for vibeCheck scripts.
 *
 * Common functionality extracted from CLI entry points to reduce duplication.
 */

import { existsSync } from "node:fs";
import type { Finding, RunContext } from "../core/types.js";
import { buildRepoInfo, getRunNumber, loadJsonFile } from "./shared.js";

/**
 * Load findings from a JSON file.
 * Exits the process if the file is not found.
 */
function loadFindings(findingsPath: string): Finding[] {
  if (!existsSync(findingsPath)) {
    console.error(`Findings file not found: ${findingsPath}`);
    process.exit(1);
  }
  return loadJsonFile<Finding[]>(findingsPath);
}

/**
 * Build a default RunContext from environment variables.
 * Used when no context file is provided.
 */
function buildDefaultContext(): RunContext {
  return {
    repo: buildRepoInfo(),
    profile: {
      languages: ["typescript"],
      packageManager: "pnpm",
      isMonorepo: false,
      workspacePackages: [],
      hasTypeScript: true,
      hasEslint: false,
      hasPrettier: false,
      hasTrunk: false,
      hasDependencyCruiser: false,
      hasKnip: false,
      rootPath: process.cwd(),
      hasPython: false,
      hasJava: false,
      hasKotlin: false,
      hasRuff: false,
      hasMypy: false,
      hasPmd: false,
      hasSpotBugs: false,
      hasRust: false,
      hasClippy: false,
      hasCargoDeny: false,
    },
    config: { version: 1 },
    cadence: "weekly",
    runNumber: getRunNumber(),
    workspacePath: process.cwd(),
    outputDir: ".",
  };
}

/**
 * Load RunContext from file or build a default one.
 */
function loadOrBuildContext(contextPath: string): RunContext {
  if (existsSync(contextPath)) {
    return loadJsonFile<RunContext>(contextPath);
  }
  return buildDefaultContext();
}

/**
 * Load findings and context for CLI scripts.
 * Combines the common pattern of loading both files.
 */
export function loadFindingsAndContext(
  findingsPath: string,
  contextPath: string,
): { findings: Finding[]; context: RunContext } {
  return {
    findings: loadFindings(findingsPath),
    context: loadOrBuildContext(contextPath),
  };
}
