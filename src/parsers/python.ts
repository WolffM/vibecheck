/**
 * Python Tool Parsers
 *
 * Parsers for Python analysis tools:
 * - Ruff (linter)
 * - Mypy (type checker)
 * - Bandit (security scanner)
 * - Vulture (dead code detector)
 */

import {
  buildLocation,
  buildLocationFromRowCol,
  createFinding,
  parseResults,
} from "../utils/parser-utils.js";
import {
  mapBanditConfidence,
  mapBanditSeverity,
  mapMypyConfidence,
  mapMypySeverity,
  mapRuffConfidence,
  mapRuffSeverity,
  mapVultureConfidence,
  mapVultureSeverity,
} from "../scoring/index.js";
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
 * Determine autofix level based on ruff's applicability field.
 * Ruff provides: "safe", "unsafe", or "display-only"
 */
function determineRuffAutofixLevel(result: RuffResult): "safe" | "requires_review" | "none" {
  if (!result.fix) {
    return "none";
  }

  // Trust ruff's own applicability assessment
  const applicability = result.fix.applicability?.toLowerCase();
  if (applicability === "safe") {
    return "safe";
  }
  if (applicability === "unsafe") {
    return "requires_review";
  }
  // display-only or unknown
  return "none";
}

/**
 * Parse Ruff JSON output into Findings.
 */
export function parseRuffOutput(output: RuffResult[], rootPath?: string): Finding[] {
  return parseResults(output, (result) => {
    const hasAutofix = !!result.fix;
    const autofix = determineRuffAutofixLevel(result);
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
        rootPath,
      ),
      hasAutofix,
      autofix,
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
export function parseMypyOutput(errors: MypyError[], rootPath?: string): Finding[] {
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
      location: buildLocation(error.file, error.line, error.column, undefined, undefined, rootPath),
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
export function parseBanditOutput(output: BanditOutput, rootPath?: string): Finding[] {
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
        rootPath,
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

// ============================================================================
// Vulture Parser (Dead Code Detector)
// ============================================================================

// Vulture output format (plain text, one per line):
// path/to/file.py:42: unused function 'old_dashboard' (60% confidence)
// path/to/file.py:10: unused import 'os' (90% confidence)
const VULTURE_LINE_RE =
  /^(.+):(\d+):\s+(unused \w+|unreachable code)\s+'?([^']*?)'?\s+\((\d+)% confidence\)/;

/**
 * Map vulture's description to a normalized ruleId.
 * "unused function" -> "unused-function", "unreachable code" -> "unreachable-code"
 */
function vultureTypeToRuleId(description: string): string {
  return description.replace(/\s+/g, "-");
}

/**
 * Parse Vulture plain-text output into Findings.
 */
export function parseVultureOutput(output: string, rootPath?: string): Finding[] {
  const findings: Finding[] = [];

  for (const line of output.split("\n")) {
    const match = line.trim().match(VULTURE_LINE_RE);
    if (!match) continue;

    const [, filePath, lineStr, description, name, confidenceStr] = match;
    const lineNum = parseInt(lineStr, 10);
    const confidence = parseInt(confidenceStr, 10);
    const ruleId = vultureTypeToRuleId(description);

    const finding = createFinding({
      result: { filePath, line: lineNum, description, name, confidence },
      tool: "vulture",
      ruleId,
      title: `Vulture: ${ruleId}`,
      message: `${description} '${name}'`,
      severity: mapVultureSeverity(ruleId),
      confidence: mapVultureConfidence(confidence),
      location: buildLocation(filePath, lineNum, undefined, undefined, undefined, rootPath),
    });

    findings.push(finding);
  }

  return findings;
}
