/**
 * Fingerprinting Module
 *
 * Generates stable fingerprints for findings to enable deduplication
 * across runs.
 *
 * Reference: vibeCop_spec.md section 8.3
 */

import { createHash } from "node:crypto";
import type { Finding } from "./types.js";

/**
 * Line bucket size for fingerprinting.
 * Lines are bucketed to tolerate minor code shifts.
 * bucket = Math.floor(startLine / BUCKET_SIZE) * BUCKET_SIZE
 */
export const LINE_BUCKET_SIZE = 20;

/**
 * Number of consecutive runs a finding must be missing
 * before auto-closing its issue (flap protection).
 */
export const FLAP_PROTECTION_RUNS = 3;

/**
 * Bucket a line number to reduce sensitivity to small changes.
 * Example: lines 1-19 -> 0, lines 20-39 -> 20, etc.
 */
export function bucketLine(line: number): number {
  return Math.floor(line / LINE_BUCKET_SIZE) * LINE_BUCKET_SIZE;
}

/**
 * Normalize a file path for fingerprinting:
 * - Convert backslashes to forward slashes
 * - Remove leading ./
 * - Lowercase (for case-insensitive comparison)
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

/**
 * Normalize a message for fingerprinting:
 * - Collapse whitespace
 * - Remove numbers that commonly change (line numbers in messages, counts)
 * - Trim
 * - Lowercase
 */
export function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").replace(/\d+/g, "#").trim().toLowerCase();
}

/**
 * Normalize a rule ID for fingerprinting:
 * - Trim
 * - Lowercase
 */
export function normalizeRuleId(ruleId: string): string {
  return ruleId.trim().toLowerCase();
}

/**
 * Build the canonical key for fingerprinting a finding.
 * Format: tool|ruleId|path|bucketedLine|normalizedMessage
 *
 * If a finding has multiple locations, use the first one (primary location).
 */
export function buildFingerprintKey(
  tool: string,
  ruleId: string,
  path: string,
  startLine: number,
  message: string,
): string {
  const normalizedTool = tool.toLowerCase();
  const normalizedRuleId = normalizeRuleId(ruleId);
  const normalizedPath = normalizePath(path);
  const bucketedLine = bucketLine(startLine);
  const normalizedMsg = normalizeMessage(message);

  return `${normalizedTool}|${normalizedRuleId}|${normalizedPath}|${bucketedLine}|${normalizedMsg}`;
}

/**
 * Compute SHA256 hash of the fingerprint key.
 * Returns hex-encoded hash prefixed with "sha256:".
 */
export function computeFingerprint(key: string): string {
  const hash = createHash("sha256").update(key, "utf-8").digest("hex");
  return `sha256:${hash}`;
}

/**
 * Generate a fingerprint for a Finding object.
 * Uses the primary location (first in array).
 */
export function fingerprintFinding(
  finding: Omit<Finding, "fingerprint">,
): string {
  const primaryLocation = finding.locations[0];
  if (!primaryLocation) {
    // No location - use tool + ruleId + message only
    const key = buildFingerprintKey(
      finding.tool,
      finding.ruleId,
      "__no_location__",
      0,
      finding.message,
    );
    return computeFingerprint(key);
  }

  const key = buildFingerprintKey(
    finding.tool,
    finding.ruleId,
    primaryLocation.path,
    primaryLocation.startLine,
    finding.message,
  );
  return computeFingerprint(key);
}

/**
 * Generate a short fingerprint for branch names.
 * Returns first 12 characters of the hash (after sha256:).
 */
export function shortFingerprint(fingerprint: string): string {
  const hash = fingerprint.replace("sha256:", "");
  return hash.substring(0, 12);
}

/**
 * Extract fingerprint from an issue body.
 * Looks for the hidden marker: <!-- vibecop:fingerprint=sha256:... -->
 */
export function extractFingerprintFromBody(body: string): string | null {
  const match = body.match(
    /<!--\s*vibecop:fingerprint=(sha256:[a-f0-9]+)\s*-->/i,
  );
  return match ? match[1] : null;
}

/**
 * Generate the hidden fingerprint marker for issue bodies.
 */
export function generateFingerprintMarker(fingerprint: string): string {
  return `<!-- vibecop:fingerprint=${fingerprint} -->`;
}

/**
 * Extract run metadata from an issue body.
 * Looks for: <!-- vibecop:run=N:lastSeen=TIMESTAMP -->
 */
export function extractRunMetadata(
  body: string,
): { run: number; lastSeen: string } | null {
  const match = body.match(/<!--\s*vibecop:run=(\d+):lastSeen=([^\s]+)\s*-->/i);
  if (match) {
    return {
      run: parseInt(match[1], 10),
      lastSeen: match[2],
    };
  }
  return null;
}

/**
 * Generate the hidden run metadata marker for issue bodies.
 */
export function generateRunMetadataMarker(
  runNumber: number,
  timestamp: string,
): string {
  return `<!-- vibecop:run=${runNumber}:lastSeen=${timestamp} -->`;
}

/**
 * Check if two fingerprints match.
 */
export function fingerprintsMatch(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Group findings by their fingerprint.
 * Useful for detecting duplicates within a single run.
 */
export function groupByFingerprint<T extends { fingerprint: string }>(
  items: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const existing = groups.get(item.fingerprint);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.fingerprint, [item]);
    }
  }
  return groups;
}

/**
 * Deduplicate findings by fingerprint.
 * Returns unique findings (first occurrence of each fingerprint).
 */
export function deduplicateFindings<T extends { fingerprint: string }>(
  items: T[],
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (!seen.has(item.fingerprint)) {
      seen.add(item.fingerprint);
      unique.push(item);
    }
  }
  return unique;
}

// ============================================================================
// Issue Merging
// ============================================================================

export type MergeStrategy = "none" | "same-file" | "same-rule" | "same-tool";

/**
 * Build a merge key based on the strategy.
 * - 'none': Each finding is unique (fingerprint)
 * - 'same-file': Merge findings with same tool + ruleId + file
 * - 'same-rule': Merge findings with same tool + ruleId (across files)
 * - 'same-tool': Merge all findings from same tool
 */
function buildMergeKey(finding: Finding, strategy: MergeStrategy): string {
  const tool = finding.tool.toLowerCase();
  const ruleId = normalizeRuleId(finding.ruleId);
  const file = finding.locations[0]?.path
    ? normalizePath(finding.locations[0].path)
    : "__no_file__";

  switch (strategy) {
    case "none":
      return finding.fingerprint;
    case "same-file":
      return `${tool}|${ruleId}|${file}`;
    case "same-rule":
      return `${tool}|${ruleId}`;
    case "same-tool":
      return tool;
    default:
      return finding.fingerprint;
  }
}

/**
 * Merge multiple findings into a single combined finding.
 * Combines all locations, evidence, and creates a summary message.
 */
function mergeFindings(findings: Finding[]): Finding {
  if (findings.length === 0) {
    throw new Error("Cannot merge empty findings array");
  }

  if (findings.length === 1) {
    return findings[0];
  }

  const base = findings[0];

  // Collect all unique locations
  const allLocations: Finding["locations"] = [];
  const seenLocations = new Set<string>();

  for (const f of findings) {
    for (const loc of f.locations) {
      const key = `${normalizePath(loc.path)}:${loc.startLine}`;
      if (!seenLocations.has(key)) {
        seenLocations.add(key);
        allLocations.push(loc);
      }
    }
  }

  // Sort locations by file, then line
  allLocations.sort((a, b) => {
    const pathCompare = normalizePath(a.path).localeCompare(
      normalizePath(b.path),
    );
    if (pathCompare !== 0) return pathCompare;
    return a.startLine - b.startLine;
  });

  // Collect all unique evidence snippets
  const evidenceSnippets: string[] = [];
  const seenEvidence = new Set<string>();

  for (const f of findings) {
    if (f.evidence) {
      const snippet =
        typeof f.evidence === "string"
          ? f.evidence
          : (f.evidence as { snippet?: string }).snippet;
      if (snippet && !seenEvidence.has(snippet)) {
        seenEvidence.add(snippet);
        evidenceSnippets.push(snippet);
      }
    }
  }

  // Build combined evidence
  const combinedEvidence =
    evidenceSnippets.length > 0
      ? { snippet: evidenceSnippets.join("\n\n---\n\n") }
      : undefined;

  // Build summary message
  const uniqueFiles = [...new Set(allLocations.map((l) => l.path))];
  const locationSummary =
    uniqueFiles.length === 1
      ? `${allLocations.length} occurrence${allLocations.length > 1 ? "s" : ""} in ${uniqueFiles[0]}`
      : `${allLocations.length} occurrence${allLocations.length > 1 ? "s" : ""} across ${uniqueFiles.length} files`;

  const message = `${base.message}\n\n**Found ${locationSummary}:**\n${allLocations.map((l) => `- \`${l.path}\` line ${l.startLine}`).join("\n")}`;

  // Create merged finding
  const merged: Omit<Finding, "fingerprint"> = {
    ...base,
    locations: allLocations,
    evidence: combinedEvidence,
    message,
    title: `${base.title} (${allLocations.length} occurrences)`,
  };

  // Generate new fingerprint for merged finding based on merge key
  const mergeKey = `merged|${base.tool}|${base.ruleId}|${uniqueFiles.sort().join(",")}`;
  const fingerprint = computeFingerprint(mergeKey);

  return {
    ...merged,
    fingerprint,
  };
}

/**
 * Merge findings based on the specified strategy.
 * Returns a new array with merged findings.
 */
export function mergeIssues(
  findings: Finding[],
  strategy: MergeStrategy = "same-file",
): Finding[] {
  if (strategy === "none") {
    return findings;
  }

  // Group findings by merge key
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    const key = buildMergeKey(finding, strategy);
    const existing = groups.get(key);
    if (existing) {
      existing.push(finding);
    } else {
      groups.set(key, [finding]);
    }
  }

  // Merge each group
  const merged: Finding[] = [];
  for (const group of groups.values()) {
    merged.push(mergeFindings(group));
  }

  return merged;
}
