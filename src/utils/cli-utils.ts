/**
 * Shared CLI utilities for vibeCheck scripts.
 *
 * Common functionality extracted from CLI entry points to reduce duplication.
 */

import { existsSync, readFileSync } from "node:fs";
import type { Finding, RunContext } from "../core/types.js";

/**
 * Load findings from a JSON file.
 * Exits the process if the file is not found.
 */
function loadFindings(findingsPath: string): Finding[] {
  if (!existsSync(findingsPath)) {
    console.error(`Findings file not found: ${findingsPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(findingsPath, "utf-8"));
}

/**
 * Build a default RunContext from environment variables.
 * Used when no context file is provided.
 */
function buildDefaultContext(): RunContext {
  return {
    repo: {
      owner: process.env.GITHUB_REPOSITORY_OWNER || "unknown",
      name: process.env.GITHUB_REPOSITORY?.split("/")[1] || "unknown",
      defaultBranch: "main",
      commit: process.env.GITHUB_SHA || "unknown",
    },
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
      hasRuff: false,
      hasMypy: false,
      hasPmd: false,
      hasSpotBugs: false,
    },
    config: { version: 1 },
    cadence: "weekly",
    runNumber: parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10),
    workspacePath: process.cwd(),
    outputDir: ".",
  };
}

/**
 * Load RunContext from file or build a default one.
 */
function loadOrBuildContext(contextPath: string): RunContext {
  if (existsSync(contextPath)) {
    return JSON.parse(readFileSync(contextPath, "utf-8"));
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
