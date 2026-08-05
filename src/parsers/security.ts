/**
 * Security Tool Parsers
 *
 * Parsers for cross-language security analysis tools:
 * - Opengrep (security vulnerability detection; semgrep-compatible JSON output)
 */

import { buildLocation, createFinding, parseResults } from "../utils/parser-utils.js";
import { mapOpengrepConfidence, mapOpengrepSeverity } from "../scoring/index.js";
import type { Finding } from "../core/types.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shorten an opengrep rule ID for display in titles.
 * Extracts the meaningful part from patterns like:
 * - python.lang.security.audit.exec-detected.exec-detected -> exec-detected
 * - javascript.lang.security.detect-child-process.detect-child-process -> detect-child-process
 */
function shortenOpengrepRuleId(ruleId: string): string {
  const parts = ruleId.split(".");

  // If the last two parts are identical (common rule-id pattern), use just one
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
// Opengrep Parser
// ============================================================================

interface OpengrepResult {
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

export interface OpengrepOutput {
  results: OpengrepResult[];
}

/**
 * Parse opengrep JSON output into Findings.
 */
export function parseOpengrepOutput(output: OpengrepOutput): Finding[] {
  return parseResults(output.results, (result) => {
    const hasAutofix = !!result.extra.fix;
    const shortRuleId = shortenOpengrepRuleId(result.check_id);
    const metadata = result.extra.metadata || {};

    // Extract CWE labels from metadata
    const extraLabels: string[] = [];
    if (metadata.cwe && Array.isArray(metadata.cwe)) {
      for (const cwe of metadata.cwe) {
        const cweMatch = (cwe as string).match(/CWE-(\d+)/);
        if (cweMatch) {
          extraLabels.push(`cwe:${cweMatch[1]}`);
        }
      }
    }

    // Extract evidence links from metadata references + source URL
    const evidenceLinks: string[] = [];
    if (metadata.references && Array.isArray(metadata.references)) {
      evidenceLinks.push(...(metadata.references as string[]));
    }
    if (metadata.source && typeof metadata.source === "string") {
      evidenceLinks.push(metadata.source);
    }
    if (metadata.shortlink && typeof metadata.shortlink === "string") {
      evidenceLinks.push(metadata.shortlink);
    }
    // Add OWASP references
    if (metadata.owasp && Array.isArray(metadata.owasp)) {
      for (const owasp of metadata.owasp) {
        if (typeof owasp === "string" && owasp.includes("A0")) {
          // Don't add as URL - just note it. The issue formatter handles CWE links.
        }
      }
    }

    const evidence: { snippet?: string; links?: string[] } = {};
    if (result.extra.lines) {
      evidence.snippet = result.extra.lines;
    }
    if (evidenceLinks.length > 0) {
      evidence.links = evidenceLinks;
    }

    return createFinding({
      result,
      tool: "opengrep",
      ruleId: result.check_id,
      title: `Opengrep: ${shortRuleId}`,
      message: result.extra.message,
      severity: mapOpengrepSeverity(result.extra.severity),
      confidence: mapOpengrepConfidence(
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
      evidence: Object.keys(evidence).length > 0 ? evidence : undefined,
      extraLabels,
    });
  });
}
