/**
 * Python Tool Parsers
 *
 * Parsers for Python analysis tools:
 * - Ruff (linter)
 * - Mypy (type checker)
 * - Bandit (security scanner)
 */

import {
  buildLocation,
  buildLocationFromRowCol,
  createFinding,
  parseResults,
} from "../utils/parser-utils.js";
import {
  determineAutofixLevel,
  mapBanditConfidence,
  mapBanditSeverity,
  mapMypyConfidence,
  mapMypySeverity,
  mapRuffConfidence,
  mapRuffSeverity,
} from "../scoring.js";
import type { Finding } from "../core/types.js";

// ============================================================================
// Ruff Parser (Python Linter)
// ============================================================================

interface RuffResult {
  code: string;
  message: string;
  filename: string;
  location: {
    row: number;
    column: number;
  };
  end_location: {
    row: number;
    column: number;
  };
  fix?: {
    applicability: string;
    message: string;
    edits: Array<{
      content: string;
      location: { row: number; column: number };
      end_location: { row: number; column: number };
    }>;
  };
  noqa_row?: number;
  url?: string;
}

/**
 * Parse Ruff JSON output into Findings.
 */
export function parseRuffOutput(output: RuffResult[]): Finding[] {
  return parseResults(output, (result) => {
    const hasAutofix = !!result.fix;
    return createFinding({
      result,
      tool: "ruff",
      ruleId: result.code,
      title: `Ruff: ${result.code}`,
      message: result.message,
      severity: mapRuffSeverity(result.code),
      confidence: mapRuffConfidence(result.code),
      location: buildLocationFromRowCol(
        result.filename,
        result.location,
        result.end_location,
      ),
      hasAutofix,
      autofix: determineAutofixLevel("ruff", result.code, hasAutofix),
    });
  });
}

// ============================================================================
// Mypy Parser (Type Checker)
// ============================================================================

interface MypyError {
  file: string;
  line: number;
  column: number;
  message: string;
  hint: string | null;
  code: string | null;
  severity: string;
}

/**
 * Parse Mypy JSON output into Findings.
 */
export function parseMypyOutput(errors: MypyError[]): Finding[] {
  return parseResults(errors, (error) => {
    // Skip notes unless they're relevant
    if (error.severity === "note" && !error.code) {
      return null;
    }

    const errorCode = error.code || "unknown";
    return createFinding({
      result: error,
      tool: "mypy",
      ruleId: errorCode,
      title: `Mypy: ${errorCode}`,
      message: error.message + (error.hint ? `\nHint: ${error.hint}` : ""),
      severity: mapMypySeverity(errorCode),
      confidence: mapMypyConfidence(errorCode),
      location: buildLocation(error.file, error.line, error.column),
    });
  });
}

// ============================================================================
// Bandit Parser (Security Scanner)
// ============================================================================

interface BanditResult {
  code: string;
  col_offset: number;
  end_col_offset: number;
  filename: string;
  issue_confidence: string;
  issue_severity: string;
  issue_cwe: { id: number; link: string };
  issue_text: string;
  line_number: number;
  line_range: number[];
  more_info: string;
  test_id: string;
  test_name: string;
}

export interface BanditOutput {
  errors: unknown[];
  generated_at: string;
  metrics: Record<string, unknown>;
  results: BanditResult[];
}

/**
 * Parse Bandit JSON output into Findings.
 */
export function parseBanditOutput(output: BanditOutput): Finding[] {
  return parseResults(output.results, (result) =>
    createFinding({
      result,
      tool: "bandit",
      ruleId: result.test_id,
      title: `Bandit: ${result.test_name}`,
      message: result.issue_text,
      severity: mapBanditSeverity(result.issue_severity),
      confidence: mapBanditConfidence(result.issue_confidence),
      location: buildLocation(
        result.filename,
        result.line_number,
        result.col_offset,
        result.line_range.length > 0
          ? result.line_range[result.line_range.length - 1]
          : result.line_number,
        result.end_col_offset,
      ),
      layer: "security",
      evidence: {
        snippet: result.code,
        links: [result.more_info, result.issue_cwe.link].filter(Boolean),
      },
      extraLabels: [`cwe:${result.issue_cwe.id}`],
    }),
  );
}
