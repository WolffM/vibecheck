/**
 * LLM JSON Builder
 *
 * Converts internal Finding[] model to LLM-friendly JSON format.
 * Includes suggested fixes, acceptance criteria, and deterministic ordering.
 *
 * Reference: vibeCheck_spec.md section 6.2
 */

import { writeFileSync } from "node:fs";
import { loadFindingsAndContext } from "../utils/cli-utils.js";
import { getSuggestedFix } from "../utils/fix-templates.js";
import { compareFindingsForSort, meetsThresholds } from "../scoring/index.js";
import type {
  Confidence,
  Finding,
  LlmJsonOutput,
  LlmJsonSummary,
  RunContext,
  Severity,
  ToolResult,
} from "../core/types.js";

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Stats passed from the analysis pipeline
 */
export interface FindingStats {
  totalFindings: number; // Raw count from all tools
  uniqueFindings: number; // After deduplication
  mergedFindings: number; // After merging
  toolResults?: ToolResult[];
}

/**
 * Build summary statistics for findings.
 */
function buildSummary(
  findings: Finding[],
  stats: FindingStats,
  severityThreshold: Severity | "info",
  confidenceThreshold: Confidence,
): LlmJsonSummary {
  const bySeverity: Record<Severity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  // Track suppressed findings (below threshold) by severity
  const suppressedBySeverity: Record<Severity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  const byTool: Record<string, number> = {};

  let highConfidence = 0;
  let actionable = 0;

  for (const finding of findings) {
    // Count by severity
    bySeverity[finding.severity]++;

    // Count by tool
    byTool[finding.tool] = (byTool[finding.tool] || 0) + 1;

    // Count high confidence
    if (finding.confidence === "high") {
      highConfidence++;
    }

    // Count actionable (meets thresholds) vs suppressed
    if (
      meetsThresholds(
        finding.severity,
        finding.confidence,
        severityThreshold,
        confidenceThreshold,
      )
    ) {
      actionable++;
    } else {
      // Track suppressed findings by their severity level
      suppressedBySeverity[finding.severity]++;
    }
  }

  // Calculate total suppressed
  const totalSuppressed = Object.values(suppressedBySeverity).reduce(
    (a, b) => a + b,
    0,
  );

  // Calculate tool execution stats
  const toolStats = stats.toolResults
    ? {
        total: stats.toolResults.length,
        successful: stats.toolResults.filter((r) => r.status === "success")
          .length,
        failed: stats.toolResults.filter((r) => r.status === "failed").length,
        skipped: stats.toolResults.filter((r) => r.status === "skipped").length,
        details: stats.toolResults,
      }
    : undefined;

  return {
    totalFindings: stats.totalFindings,
    uniqueFindings: stats.uniqueFindings,
    mergedFindings: stats.mergedFindings,
    highConfidence,
    actionable,
    bySeverity,
    byTool,
    // Only include suppressed section if there are suppressed findings
    ...(totalSuppressed > 0 && {
      suppressed: {
        bySeverity: suppressedBySeverity,
        total: totalSuppressed,
      },
    }),
    // Include tool execution stats if available
    ...(toolStats && { toolsRun: toolStats }),
  };
}

// ============================================================================
// Main Builder
// ============================================================================

/**
 * Build LLM JSON output from findings.
 */
export function buildLlmJson(
  findings: Finding[],
  context: RunContext,
  stats?: FindingStats,
): LlmJsonOutput {
  // Sort findings deterministically
  const sortedFindings = [...findings].sort(compareFindingsForSort);

  // Enrich with suggested fixes
  const enrichedFindings = sortedFindings.map((finding) => {
    // Remove rawOutput for LLM JSON (keep it lean)
    const { rawOutput, ...cleanFinding } = finding;

    return {
      ...cleanFinding,
      suggestedFix: finding.suggestedFix || getSuggestedFix(finding),
    };
  });

  const severityThreshold =
    context.config.issues?.severity_threshold || "medium";
  const confidenceThreshold =
    context.config.issues?.confidence_threshold || "high";

  // Use provided stats or default to findings length for all counts
  const effectiveStats: FindingStats = stats || {
    totalFindings: findings.length,
    uniqueFindings: findings.length,
    mergedFindings: findings.length,
  };

  return {
    version: 1,
    repo: context.repo,
    generatedAt: new Date().toISOString(),
    profile: {
      isMonorepo: context.profile.isMonorepo,
      languages: context.profile.languages,
      packageManager: context.profile.packageManager,
    },
    summary: buildSummary(
      findings,
      effectiveStats,
      severityThreshold,
      confidenceThreshold,
    ),
    findings: enrichedFindings,
  };
}

/**
 * Write LLM JSON to file.
 */
export function writeLlmJsonFile(output: LlmJsonOutput, path: string): void {
  writeFileSync(path, JSON.stringify(output, null, 2), "utf-8");
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const findingsPath = args[0] || "findings.json";
  const outputPath = args[1] || "results.llm.json";
  const contextPath = args[2] || "context.json";

  const { findings, context } = loadFindingsAndContext(
    findingsPath,
    contextPath,
  );

  // Build and write LLM JSON
  const output = buildLlmJson(findings, context);
  writeLlmJsonFile(output, outputPath);

  console.log(`LLM JSON output written to: ${outputPath}`);
  console.log(`Total findings: ${output.summary.totalFindings}`);
  console.log(`Actionable: ${output.summary.actionable}`);
  console.log(`High confidence: ${output.summary.highConfidence}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
