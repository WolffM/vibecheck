/**
 * Severity and Confidence Hierarchy
 *
 * Defines ordering and comparison functions for severity and confidence levels.
 */

import type { Confidence, Severity } from "../core/types.js";

// ============================================================================
// Severity Ordering
// ============================================================================

/**
 * Severity hierarchy (for comparisons).
 * Higher number = more severe.
 * 'info' is added as level 0 for threshold purposes (accepts all severities).
 */
export const SEVERITY_ORDER: Record<Severity | "info", number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Compare severities. Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

/**
 * Check if severity meets threshold.
 * Accepts 'info' as threshold to allow all severities.
 */
export function meetsSeverityThreshold(
  severity: Severity,
  threshold: Severity | "info",
): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold];
}

// ============================================================================
// Confidence Ordering
// ============================================================================

/**
 * Confidence hierarchy (for comparisons).
 */
export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Compare confidence levels.
 */
export function compareConfidence(a: Confidence, b: Confidence): number {
  return CONFIDENCE_ORDER[a] - CONFIDENCE_ORDER[b];
}

/**
 * Check if confidence meets threshold.
 */
export function meetsConfidenceThreshold(
  confidence: Confidence,
  threshold: Confidence,
): boolean {
  return CONFIDENCE_ORDER[confidence] >= CONFIDENCE_ORDER[threshold];
}

// ============================================================================
// Combined Threshold Checking
// ============================================================================

/**
 * Check if a finding meets severity and confidence thresholds.
 * Use 'info' for severity threshold to allow all severities.
 */
export function meetsThresholds(
  severity: Severity,
  confidence: Confidence,
  severityThreshold: Severity | "info",
  confidenceThreshold: Confidence,
): boolean {
  return (
    meetsSeverityThreshold(severity, severityThreshold) &&
    meetsConfidenceThreshold(confidence, confidenceThreshold)
  );
}

// ============================================================================
// Sorting
// ============================================================================

/**
 * Compare two findings for deterministic sorting.
 * Order: severity desc, confidence desc, path asc, line asc
 */
export function compareFindingsForSort(
  a: {
    severity: Severity;
    confidence: Confidence;
    locations: { path: string; startLine: number }[];
  },
  b: {
    severity: Severity;
    confidence: Confidence;
    locations: { path: string; startLine: number }[];
  },
): number {
  // Severity descending
  const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  if (severityDiff !== 0) return severityDiff;

  // Confidence descending
  const confidenceDiff =
    CONFIDENCE_ORDER[b.confidence] - CONFIDENCE_ORDER[a.confidence];
  if (confidenceDiff !== 0) return confidenceDiff;

  // Path ascending
  const pathA = a.locations[0]?.path ?? "";
  const pathB = b.locations[0]?.path ?? "";
  const pathDiff = pathA.localeCompare(pathB);
  if (pathDiff !== 0) return pathDiff;

  // Line ascending
  const lineA = a.locations[0]?.startLine ?? 0;
  const lineB = b.locations[0]?.startLine ?? 0;
  return lineA - lineB;
}
