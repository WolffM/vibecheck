/**
 * Autofix Runner
 *
 * Executes autofix commands for tools with safe autofix findings.
 * Groups findings by tool, looks up fix commands from registry,
 * and runs the appropriate fix command for each tool.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { Finding } from "../core/types.js";
import {
  type AutofixCommand,
  type AutofixConfig,
  getAutofixCommand,
} from "./autofix-registry.js";
import { isToolAvailable } from "./tool-utils.js";
import { MAX_OUTPUT_BUFFER } from "../utils/shared.js";

// ============================================================================
// Types
// ============================================================================

export interface AutofixResult {
  /** Tool name */
  tool: string;
  /** Files that were passed to the fix command */
  files: string[];
  /** Whether the fix command succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Command that was run (for debugging) */
  command?: string;
  /** Autofix level: safe (auto-merge OK) or requires_review (draft PR) */
  level: "safe" | "requires_review";
}

export interface AutofixSummary {
  /** Total tools processed */
  toolsProcessed: number;
  /** Tools that succeeded */
  toolsSucceeded: number;
  /** Tools that failed */
  toolsFailed: number;
  /** Tools skipped (not available or no files) */
  toolsSkipped: number;
  /** Per-tool results */
  results: AutofixResult[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Group findings by tool for a specific autofix level.
 * Returns a map of tool -> file paths.
 */
export function groupAutofixFindings(
  findings: Finding[],
  level: "safe" | "requires_review",
): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const finding of findings) {
    if (finding.autofix !== level) {
      continue;
    }

    const tool = finding.tool;
    if (!grouped.has(tool)) {
      grouped.set(tool, new Set());
    }

    // Add all file paths from this finding
    for (const location of finding.locations) {
      if (location.path) {
        grouped.get(tool)!.add(location.path);
      }
    }
  }

  return grouped;
}

/**
 * Run a single autofix command for a tool.
 */
function runAutofixCommand(
  tool: string,
  command: AutofixCommand,
  files: string[],
  rootPath: string,
  level: "safe" | "requires_review",
): AutofixResult {
  // Normalize file paths to be relative to rootPath
  const normalizedFiles = files
    .map((f) => {
      // Convert absolute paths to relative
      const absPath = resolve(rootPath, f);
      if (existsSync(absPath)) {
        return relative(rootPath, absPath);
      }
      // Try the path as-is
      if (existsSync(resolve(rootPath, f))) {
        return f;
      }
      return null;
    })
    .filter((f): f is string => f !== null);

  if (normalizedFiles.length === 0) {
    return {
      tool,
      files: [],
      success: true,
      error: "No valid files found",
      level,
    };
  }

  // Check if tool is available
  const { available, useNpx: detectedUseNpx } = isToolAvailable(
    command.command,
    command.useNpx ?? true,
  );

  if (!available) {
    return {
      tool,
      files: normalizedFiles,
      success: false,
      error: `Tool "${command.command}" is not available`,
      level,
    };
  }

  // Determine whether to use npx
  const useNpx = command.useNpx ?? detectedUseNpx;

  // Build the command
  const cmd = useNpx ? "npx" : command.command;
  const args = useNpx
    ? [command.command, ...command.args, ...normalizedFiles]
    : [...command.args, ...normalizedFiles];

  const fullCommand = `${cmd} ${args.join(" ")}`;
  console.log(`  Running: ${fullCommand}`);

  try {
    const result = spawnSync(cmd, args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: MAX_OUTPUT_BUFFER,
    });

    // Most linters return non-zero when they find issues, but we're fixing
    // so we check if it actually ran (no error) rather than exit code
    if (result.error) {
      return {
        tool,
        files: normalizedFiles,
        success: false,
        error: result.error.message,
        command: fullCommand,
        level,
      };
    }

    // Log any stderr (but not as error - some tools output warnings there)
    if (result.stderr && result.stderr.trim()) {
      const stderrLines = result.stderr.trim().split("\n").slice(0, 5);
      if (stderrLines.length > 0) {
        console.log(`  ${tool} output: ${stderrLines.join(" | ")}`);
      }
    }

    return {
      tool,
      files: normalizedFiles,
      success: true,
      command: fullCommand,
      level,
    };
  } catch (error) {
    return {
      tool,
      files: normalizedFiles,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      command: fullCommand,
      level,
    };
  }
}

/**
 * Run autofix commands for all tools with autofixable findings.
 * Processes both "safe" and "requires_review" findings separately.
 *
 * @param rootPath - Repository root path
 * @param findings - All findings from analysis
 * @param userConfig - Optional user autofix config from vibecheck.yml
 * @param includeReviewFixes - Whether to include requires_review fixes (default: true)
 * @returns Summary of autofix results
 */
export function runAutofix(
  rootPath: string,
  findings: Finding[],
  userConfig?: AutofixConfig,
  includeReviewFixes: boolean = true,
): AutofixSummary {
  console.log("Running autofixes...");

  // Debug: Count autofix values
  const autofixCounts: Record<string, number> = {};
  for (const f of findings) {
    const val = f.autofix || "undefined";
    autofixCounts[val] = (autofixCounts[val] || 0) + 1;
  }
  console.log(`  Autofix distribution: ${JSON.stringify(autofixCounts)}`);

  // Group findings by tool for each level
  const safeGrouped = groupAutofixFindings(findings, "safe");
  const reviewGrouped = includeReviewFixes
    ? groupAutofixFindings(findings, "requires_review")
    : new Map<string, Set<string>>();

  console.log(
    `  Found ${safeGrouped.size} tools with safe autofix: ${Array.from(safeGrouped.keys()).join(", ") || "(none)"}`,
  );
  if (includeReviewFixes && reviewGrouped.size > 0) {
    console.log(
      `  Found ${reviewGrouped.size} tools with review autofix: ${Array.from(reviewGrouped.keys()).join(", ")}`,
    );
  }

  const results: AutofixResult[] = [];
  let toolsSucceeded = 0;
  let toolsFailed = 0;
  let toolsSkipped = 0;

  // Helper to process a group of findings at a specific level
  function processGroup(
    grouped: Map<string, Set<string>>,
    level: "safe" | "requires_review",
  ) {
    for (const [tool, filesSet] of grouped) {
      const files = Array.from(filesSet);
      const levelLabel = level === "safe" ? "safe" : "review";
      console.log(`\n  Processing ${tool} [${levelLabel}] (${files.length} files)...`);

      // Get autofix command from registry
      const command = getAutofixCommand(tool, userConfig);
      if (!command) {
        console.log(`    Skipping ${tool}: no autofix command registered`);
        toolsSkipped++;
        results.push({
          tool,
          files,
          success: false,
          error: "No autofix command registered",
          level,
        });
        continue;
      }

      // Run the autofix command
      const result = runAutofixCommand(tool, command, files, rootPath, level);
      results.push(result);

      if (result.success) {
        console.log(`    ✓ ${tool} autofix completed [${levelLabel}]`);
        toolsSucceeded++;
      } else {
        console.log(`    ✗ ${tool} autofix failed: ${result.error}`);
        toolsFailed++;
      }
    }
  }

  // Process safe fixes first
  processGroup(safeGrouped, "safe");

  // Then process requires_review fixes
  if (includeReviewFixes) {
    processGroup(reviewGrouped, "requires_review");
  }

  const totalProcessed = safeGrouped.size + (includeReviewFixes ? reviewGrouped.size : 0);
  const summary: AutofixSummary = {
    toolsProcessed: totalProcessed,
    toolsSucceeded,
    toolsFailed,
    toolsSkipped,
    results,
  };

  console.log(
    `\nAutofix complete: ${toolsSucceeded} succeeded, ${toolsFailed} failed, ${toolsSkipped} skipped`,
  );

  return summary;
}
