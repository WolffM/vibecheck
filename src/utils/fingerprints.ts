/**
 * Fingerprinting Module
 *
 * Generates stable fingerprints for findings to enable deduplication
 * across runs.
 *
 * Reference: vibeCheck_spec.md section 8.3
 */

import { createHash } from "node:crypto";
import type { Finding } from "../core/types.js";

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
 * 
 * NOTE: This differs from parser-utils.normalizePath which handles CI paths
 * but does NOT lowercase (for display). This version lowercases for comparison.
 */
export function normalizePathForFingerprint(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//g, "").toLowerCase();
}

// Re-export for backwards compatibility and tests
export { normalizePathForFingerprint as normalizePath };

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
  const normalizedPath = normalizePathForFingerprint(path);
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
 * Looks for the hidden marker: <!-- vibecheck:fingerprint=sha256:... -->
 * Also accepts legacy vibecop: prefix for backwards compatibility.
 */
export function extractFingerprintFromBody(body: string): string | null {
  const match = body.match(
    /<!--\s*(?:vibecheck|vibecop):fingerprint=(sha256:[a-f0-9]+)\s*-->/i,
  );
  return match ? match[1] : null;
}

/**
 * Generate the hidden fingerprint marker for issue bodies.
 */
export function generateFingerprintMarker(fingerprint: string): string {
  return `<!-- vibecheck:fingerprint=${fingerprint} -->`;
}

/**
 * Extract run metadata from an issue body.
 * Looks for: <!-- vibecheck:run=N:lastSeen=TIMESTAMP -->
 * Also accepts legacy vibecop: prefix for backwards compatibility.
 */
export function extractRunMetadata(
  body: string,
): { run: number; lastSeen: string } | null {
  const match = body.match(
    /<!--\s*(?:vibecheck|vibecop):run=(\d+):lastSeen=([^\s]+)\s*-->/i,
  );
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
  return `<!-- vibecheck:run=${runNumber}:lastSeen=${timestamp} -->`;
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

export type MergeStrategy =
  | "none"
  | "same-file"
  | "same-rule"
  | "same-tool"
  | "same-linter";

/**
 * Check if a finding is from the test-fixtures directory.
 * Test-fixtures findings are kept separate (as "demo" issues) from real issues.
 */
export function isTestFixtureFinding(finding: Finding): boolean {
  const file = finding.locations[0]?.path || "";
  const normalizedFile = normalizePathForFingerprint(file);
  return (
    normalizedFile.startsWith("test-fixtures/") ||
    normalizedFile.includes("/test-fixtures/")
  );
}

/**
 * Build a merge key based on the strategy.
 * - 'none': Each finding is unique (fingerprint)
 * - 'same-file': Merge findings with same tool + ruleId + file
 * - 'same-rule': Merge findings with same tool + ruleId (across files)
 * - 'same-tool': Merge all findings from same tool
 * - 'same-linter': For trunk, merge by sublinter (markdownlint, yamllint, etc.)
 *
 * IMPORTANT: Findings from test-fixtures/ are always merged by tool to keep
 * demo issues minimal (1-2 issues per tool). They are prefixed with "demo|"
 * to keep them separate from real issues.
 */
function buildMergeKey(finding: Finding, strategy: MergeStrategy): string {
  const tool = finding.tool.toLowerCase();
  const ruleId = normalizeRuleId(finding.ruleId);
  const file = finding.locations[0]?.path
    ? normalizePathForFingerprint(finding.locations[0].path)
    : "__no_file__";

  // For test-fixtures, always merge by tool to minimize demo issues
  // This creates ~1 issue per tool instead of many
  if (isTestFixtureFinding(finding)) {
    // For trunk, still split by sublinter (markdownlint, yamllint, etc.)
    if (tool === "trunk") {
      const sublinter = extractSublinter(finding);
      return `demo|${tool}|${sublinter}`;
    }
    return `demo|${tool}`;
  }

  // Normal merge logic for non-demo findings
  switch (strategy) {
    case "none":
      return finding.fingerprint;
    case "same-file":
      return `${tool}|${ruleId}|${file}`;
    case "same-rule":
      return `${tool}|${ruleId}`;
    case "same-tool":
      return tool;
    case "same-linter": {
      // For trunk findings, extract the sublinter from the title
      // e.g., "markdownlint: MD026" -> "markdownlint"
      // e.g., "yamllint: quoted-strings" -> "yamllint"
      const sublinter = extractSublinter(finding);
      return `${tool}|${sublinter}`;
    }
    default:
      return finding.fingerprint;
  }
}

/**
 * Extract sublinter name from a trunk finding or title string.
 * Trunk findings have titles like "markdownlint: MD026" or "yamllint: syntax"
 * 
 * @param findingOrTitle - Either a Finding object or a title string
 */
export function extractSublinter(findingOrTitle: Finding | string): string {
  const title = typeof findingOrTitle === "string" 
    ? findingOrTitle 
    : findingOrTitle.title;
  const ruleId = typeof findingOrTitle === "string" 
    ? "" 
    : findingOrTitle.ruleId;
    
  // Check if title has format "sublinter: rule" or "[vibeCheck] sublinter: rule"
  const titleMatch = title.match(/(?:\[vibeCheck\]\s+)?(\w+)[\s:(\-]/i);
  if (titleMatch) {
    return titleMatch[1].toLowerCase();
  }
  // Check if ruleId has a prefix
  if (ruleId) {
    const ruleMatch = ruleId.match(/^([A-Z]+)\d/);
    if (ruleMatch) {
      // MD rules -> markdownlint, CKV -> checkov, etc.
      const prefix = ruleMatch[1].toLowerCase();
      const prefixMap: Record<string, string> = {
        md: "markdownlint",
        ckv: "checkov",
        ghsa: "osv-scanner",
      };
      return prefixMap[prefix] || ruleId;
    }
    return ruleId;
  }
  return title;
}

/**
 * Format locations grouped by file for cleaner display.
 * Instead of listing each location on a separate line, groups by file:
 * - `file1.ts`: lines 5, 10, 15 (3 total)
 * - `file2.ts`: line 8
 */
function formatLocationsGroupedByFile(
  locations: { path: string; startLine: number }[],
  maxLinesPerFile: number = 8,
): string {
  // Group locations by file
  const byFile = new Map<string, number[]>();
  for (const loc of locations) {
    const lines = byFile.get(loc.path) || [];
    lines.push(loc.startLine);
    byFile.set(loc.path, lines);
  }

  // Format each file group
  const lines: string[] = [];
  for (const [path, lineNumbers] of byFile) {
    // Sort line numbers
    lineNumbers.sort((a, b) => a - b);
    
    if (lineNumbers.length === 1) {
      lines.push(`- \`${path}\` line ${lineNumbers[0]}`);
    } else if (lineNumbers.length <= maxLinesPerFile) {
      // Show all lines: "lines 5, 10, 15"
      lines.push(`- \`${path}\` lines ${lineNumbers.join(", ")}`);
    } else {
      // Truncate: "lines 5, 10, 15, ... (42 total)"
      const shown = lineNumbers.slice(0, maxLinesPerFile);
      lines.push(`- \`${path}\` lines ${shown.join(", ")}, ... (${lineNumbers.length} total)`);
    }
  }

  return lines.join("\n");
}

/**
 * Merge multiple findings into a single combined finding.
 * Combines all locations, evidence, and creates a summary message.
 * Returns finding without fingerprint - caller sets it based on merge key.
 */
function mergeFindings(
  findings: Finding[],
  strategy: MergeStrategy = "same-file",
): Omit<Finding, "fingerprint"> {
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
      const key = `${normalizePathForFingerprint(loc.path)}:${loc.startLine}`;
      if (!seenLocations.has(key)) {
        seenLocations.add(key);
        allLocations.push(loc);
      }
    }
  }

  // Sort locations by file, then line
  allLocations.sort((a, b) => {
    const pathCompare = normalizePathForFingerprint(a.path).localeCompare(
      normalizePathForFingerprint(b.path),
    );
    if (pathCompare !== 0) return pathCompare;
    return a.startLine - b.startLine;
  });

  // Collect all unique evidence snippets with file context
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
        
        // Special handling for jscpd - show both locations for the duplicate pair
        if (base.tool === "jscpd" && f.locations.length >= 2) {
          const loc1 = f.locations[0];
          const loc2 = f.locations[1];
          const pairHeader = `**Duplicate pair:** \`${loc1.path}:${loc1.startLine}\` ↔ \`${loc2.path}:${loc2.startLine}\``;
          evidenceSnippets.push(`${pairHeader}\n\`\`\`\n${snippet}\n\`\`\``);
        } else {
          // Add file context to the snippet if we have location info
          const loc = f.locations[0];
          if (loc) {
            const fileHeader = `📄 ${loc.path}:${loc.startLine}`;
            evidenceSnippets.push(`${fileHeader}\n${snippet}`);
          } else {
            evidenceSnippets.push(snippet);
          }
        }
      }
    }
  }

  // Collect evidence links from all findings
  const allLinks: string[] = [];
  for (const f of findings) {
    if (f.evidence?.links) {
      for (const link of f.evidence.links) {
        if (link && !allLinks.includes(link)) {
          allLinks.push(link);
        }
      }
    }
  }

  // Build combined evidence
  const combinedEvidence =
    evidenceSnippets.length > 0 || allLinks.length > 0
      ? {
          snippet:
            evidenceSnippets.length > 0
              ? evidenceSnippets.join("\n\n---\n\n")
              : undefined,
          links: allLinks.length > 0 ? allLinks : undefined,
        }
      : undefined;

  // Build summary message
  const uniqueFiles = [...new Set(allLocations.map((l) => l.path))];
  const uniqueRules = [...new Set(findings.map((f) => f.ruleId))];
  const locationSummary =
    uniqueFiles.length === 1
      ? `${allLocations.length} occurrence${allLocations.length > 1 ? "s" : ""} in ${uniqueFiles[0]}`
      : `${allLocations.length} occurrence${allLocations.length > 1 ? "s" : ""} across ${uniqueFiles.length} files`;

  // Build message - special handling for tools with context-specific base messages
  let baseMessage: string;
  if (base.tool === "jscpd" && findings.length > 1) {
    // jscpd messages say "between X and Y" which is confusing when merged
    // Calculate total duplicate lines from all findings
    const totalLines = findings.reduce((sum, f) => {
      const match = f.title.match(/(\d+)\s*lines/);
      return sum + (match ? parseInt(match[1], 10) : 0);
    }, 0);
    
    // Build a clearer description of duplicate pairs
    const pairDescriptions = findings.map((f) => {
      const locs = f.locations;
      if (locs.length >= 2) {
        const match = f.title.match(/(\d+)\s*lines/);
        const lines = match ? match[1] : "?";
        return `- \`${locs[0].path}\` ↔ \`${locs[1].path}\` (${lines} lines)`;
      }
      return null;
    }).filter(Boolean);
    
    baseMessage = `Found ${totalLines} total duplicate lines across ${uniqueFiles.length} files. Consider extracting shared logic into reusable functions or modules.\n\n**Duplicate pairs:**\n${pairDescriptions.join("\n")}`;
  } else {
    baseMessage = base.message;
  }

  // Add rule summary when multiple rules are merged (same-linter strategy)
  let ruleSummary = "";
  if (strategy === "same-linter" && uniqueRules.length > 1) {
    // Get short names for each rule for cleaner display
    const shortRuleNames = uniqueRules.map((r) => {
      // Extract last meaningful part of rule ID
      const parts = r.split(/[./]/);
      return parts[parts.length - 1] || r;
    });
    ruleSummary = `\n\n**Grouped rules (${uniqueRules.length}):** ${shortRuleNames.join(", ")}`;
  }

  // Format locations grouped by file for cleaner display
  const formattedLocations = formatLocationsGroupedByFile(allLocations);
  const message = `${baseMessage}${ruleSummary}\n\n**Found ${locationSummary}:**\n${formattedLocations}`;

  // Build title based on strategy
  let title: string;
  if (strategy === "same-linter" && uniqueRules.length > 1) {
    // For same-linter merge with multiple rules, use sublinter name
    const sublinter = extractSublinter(base);
    title = `${sublinter} (${allLocations.length} issues across ${uniqueRules.length} rules)`;
  } else if (allLocations.length > 1) {
    // For jscpd, don't add occurrence count - the title already shows "X lines" of duplication
    // Adding "(Y occurrences)" is redundant and confusing
    if (base.tool === "jscpd") {
      title = base.title;
    } else {
      title = `${base.title} (${allLocations.length} occurrences)`;
    }
  } else {
    title = base.title;
  }

  // Create merged finding
  const merged: Omit<Finding, "fingerprint"> = {
    ...base,
    locations: allLocations,
    evidence: combinedEvidence,
    message,
    title,
    // For same-linter merges, update ruleId to reflect multiple rules
    ruleId:
      strategy === "same-linter" && uniqueRules.length > 1
        ? uniqueRules.join("+")
        : base.ruleId,
  };

  // Fingerprint is set by caller based on merge key
  return merged;
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
  for (const [mergeKey, group] of groups.entries()) {
    const mergedFinding = mergeFindings(group, strategy);
    // Use merge key for stable fingerprint (doesn't change as files are added/removed)
    const stableFingerprint = computeFingerprint(mergeKey);
    merged.push({
      ...mergedFinding,
      fingerprint: stableFingerprint,
    });
  }

  return merged;
}
