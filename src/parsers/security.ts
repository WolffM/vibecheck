/**
 * Security Tool Parsers
 *
 * Parsers for cross-language security analysis tools:
 * - Semgrep (security vulnerability detection)
 */

import { buildLocation, createFinding, parseResults } from "../utils/parser-utils.js";
import { mapSemgrepConfidence, mapSemgrepSeverity } from "../scoring.js";
import type { Finding } from "../core/types.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shorten a semgrep rule ID for display in titles.
 * Extracts the meaningful part from patterns like:
 * - python.lang.security.audit.exec-detected.exec-detected -> exec-detected
 * - javascript.lang.security.detect-child-process.detect-child-process -> detect-child-process
 */
function shortenSemgrepRuleId(ruleId: string): string {
  const parts = ruleId.split(".");
  
  // If the last two parts are identical (common semgrep pattern), use just one
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    return parts[parts.length - 1];
  }
  
  // Otherwise use the last part
  if (parts.length > 0) {
    return parts[parts.length - 1];
  }
  
  return ruleId;
}

// ============================================================================
// Semgrep Parser
// ============================================================================

interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    metadata?: {
      confidence?: string;
      [key: string]: unknown;
    };
    fix?: string;
    lines?: string;
  };
}

export interface SemgrepOutput {
  results: SemgrepResult[];
}

/**
 * Parse semgrep JSON output into Findings.
 */
export function parseSemgrepOutput(output: SemgrepOutput): Finding[] {
  return parseResults(output.results, (result) => {
    const hasAutofix = !!result.extra.fix;
    const shortRuleId = shortenSemgrepRuleId(result.check_id);
    return createFinding({
      result,
      tool: "semgrep",
      ruleId: result.check_id,
      title: `Semgrep: ${shortRuleId}`,
      message: result.extra.message,
      severity: mapSemgrepSeverity(result.extra.severity),
      confidence: mapSemgrepConfidence(
        result.extra.metadata?.confidence as string | undefined,
      ),
      location: buildLocation(
        result.path,
        result.start.line,
        result.start.col,
        result.end.line,
        result.end.col,
      ),
      hasAutofix,
      evidence: result.extra.lines
        ? { snippet: result.extra.lines }
        : undefined,
    });
  });
}
