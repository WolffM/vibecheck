/**
 * Parser Utilities
 *
 * Generic helpers for building Findings from tool output.
 * Reduces duplication across individual parsers.
 */

import { fingerprintFinding } from "./fingerprints.js";
import { classifyLayer } from "../scoring.js";
import type {
  AutofixLevel,
  Confidence,
  Evidence,
  Finding,
  Layer,
  Location,
  Severity,
  ToolName,
} from "../core/types.js";

// ============================================================================
// Path Normalization
// ============================================================================

/**
 * Normalize a file path for consistent display and linking.
 * - Removes absolute path prefixes (e.g., /home/runner/work/repo/repo/)
 * - Removes leading ./ prefixes
 * - Converts backslashes to forward slashes
 */
export function normalizePath(path: string): string {
  let normalized = path;

  // Convert backslashes to forward slashes (Windows compatibility)
  normalized = normalized.replace(/\\/g, "/");

  // Remove common CI absolute path prefixes
  // GitHub Actions: /home/runner/work/{repo}/{repo}/
  const githubActionsMatch = normalized.match(
    /^\/home\/runner\/work\/[^/]+\/[^/]+\/(.+)$/,
  );
  if (githubActionsMatch) {
    normalized = githubActionsMatch[1];
  }

  // Generic: Remove any path that looks like an absolute path to a workspace
  // Pattern: /anything/work/reponame/reponame/ or similar CI patterns
  const ciPathMatch = normalized.match(/^\/[^/]+(?:\/[^/]+)*\/work\/[^/]+\/[^/]+\/(.+)$/);
  if (ciPathMatch) {
    normalized = ciPathMatch[1];
  }

  // Handle relative paths with ../ that reference the target repo
  // Pattern: ../../../../reponame/reponame/path -> path
  // This happens when tsc runs from vibeCheck action dir but checks target repo
  const relativeRepoMatch = normalized.match(/^(?:\.\.\/)+[^/]+\/[^/]+\/(.+)$/);
  if (relativeRepoMatch) {
    normalized = relativeRepoMatch[1];
  }

  // Remove leading ./
  if (normalized.startsWith("./")) {
    normalized = normalized.substring(2);
  }

  // Remove leading /
  if (normalized.startsWith("/")) {
    normalized = normalized.substring(1);
  }

  return normalized;
}

// ============================================================================
// Types
// ============================================================================

/** Configuration for creating a finding from tool output */
export interface FindingConfig<T> {
  /** The raw tool result being converted */
  result: T;
  /** Tool identifier */
  tool: ToolName;
  /** Rule/check identifier */
  ruleId: string;
  /** Finding title */
  title: string;
  /** Finding message/description */
  message: string;
  /** Mapped severity */
  severity: Severity;
  /** Mapped confidence */
  confidence: Confidence;
  /** Primary location */
  location: Location;
  /** Additional locations (optional) */
  additionalLocations?: Location[];
  /** Override layer classification (optional) */
  layer?: Layer;
  /** Has autofix available */
  hasAutofix?: boolean;
  /** Override autofix level */
  autofix?: AutofixLevel;
  /** Evidence (snippets, links) */
  evidence?: Evidence;
  /** Additional labels beyond defaults */
  extraLabels?: string[];
}

// ============================================================================
// Location Builders
// ============================================================================

/**
 * Build a Location object with standard fields.
 * Automatically normalizes the path to remove CI absolute paths and ./ prefixes.
 */
export function buildLocation(
  path: string,
  startLine: number,
  startColumn?: number,
  endLine?: number,
  endColumn?: number,
): Location {
  const location: Location = {
    path: normalizePath(path),
    startLine,
  };

  if (startColumn !== undefined) location.startColumn = startColumn;
  if (endLine !== undefined) location.endLine = endLine;
  if (endColumn !== undefined) location.endColumn = endColumn;

  return location;
}

/**
 * Build a Location from common row/column format (Ruff, Mypy).
 */
export function buildLocationFromRowCol(
  path: string,
  start: { row: number; column: number },
  end?: { row: number; column: number },
): Location {
  return buildLocation(path, start.row, start.column, end?.row, end?.column);
}

// ============================================================================
// Finding Builder
// ============================================================================

/**
 * Create a Finding from configuration.
 * Handles layer classification, labels, and fingerprinting.
 */
export function createFinding<T>(config: FindingConfig<T>): Finding {
  const {
    result,
    tool,
    ruleId,
    title,
    message,
    severity,
    confidence,
    location,
    additionalLocations = [],
    layer,
    hasAutofix = false,
    autofix,
    evidence,
    extraLabels = [],
  } = config;

  // Determine layer from classification if not provided
  const effectiveLayer = layer ?? classifyLayer(tool, ruleId);

  // Determine autofix level
  const effectiveAutofix = autofix ?? (hasAutofix ? "requires_review" : "none");

  // Build standard labels
  const labels = [
    "vibeCheck",
    `tool:${tool}`,
    `severity:${severity}`,
    ...extraLabels,
  ];

  // Combine locations
  const locations = [location, ...additionalLocations];

  // Build the finding without fingerprint
  const finding: Omit<Finding, "fingerprint"> = {
    layer: effectiveLayer,
    tool,
    ruleId,
    title,
    message,
    severity,
    confidence,
    autofix: effectiveAutofix,
    locations,
    labels,
    rawOutput: result,
  };

  // Add optional evidence
  if (evidence) {
    finding.evidence = evidence;
  }

  // Add fingerprint and return
  return {
    ...finding,
    fingerprint: fingerprintFinding(finding),
  };
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Process an array of tool results into findings using a mapper function.
 */
export function parseResults<T>(
  results: T[],
  mapper: (result: T) => Finding | null,
): Finding[] {
  const findings: Finding[] = [];

  for (const result of results) {
    const finding = mapper(result);
    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}
