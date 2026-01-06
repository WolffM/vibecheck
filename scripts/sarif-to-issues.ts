/**
 * SARIF to Issues Converter
 *
 * Creates and updates GitHub issues from findings with deduplication,
 * rate limiting, and flap protection.
 *
 * Reference: vibeCop_spec.md section 8
 */

import { readFileSync, existsSync } from "node:fs";
import { getSuggestedFix } from "./build-llm-json.js";
import {
  deduplicateFindings,
  FLAP_PROTECTION_RUNS,
  generateFingerprintMarker,
  generateRunMetadataMarker,
  isTestFixtureFinding,
  shortFingerprint,
} from "./fingerprints.js";
import {
  addIssueComment,
  buildFingerprintMap,
  closeIssue,
  createIssue,
  DEFAULT_LABELS,
  ensureLabels,
  parseGitHubRepository,
  searchIssuesByLabel,
  updateIssue,
  withRateLimit,
} from "./github.js";
import { meetsThresholds } from "./scoring.js";
import type { ExistingIssue, Finding, RunContext } from "./types.js";

// ============================================================================
// Issue Body Template
// ============================================================================

/**
 * Get the documentation URL for a rule ID.
 */
function getRuleDocUrl(tool: string, ruleId: string): string | null {
  // ESLint rules
  if (tool === "eslint" || tool === "trunk") {
    // Check for GHSA (GitHub Security Advisory)
    if (ruleId.startsWith("GHSA-")) {
      return `https://github.com/advisories/${ruleId}`;
    }
    // Check for CWE
    if (ruleId.startsWith("CWE-")) {
      return `https://cwe.mitre.org/data/definitions/${ruleId.replace("CWE-", "")}.html`;
    }
    // Check for Checkov rules
    if (ruleId.startsWith("CKV_")) {
      return `https://www.checkov.io/5.Policy%20Index/${ruleId}.html`;
    }
    // ESLint core rules
    if (ruleId.match(/^[a-z-]+$/)) {
      return `https://eslint.org/docs/rules/${ruleId}`;
    }
    // TypeScript ESLint rules
    if (ruleId.startsWith("@typescript-eslint/")) {
      return `https://typescript-eslint.io/rules/${ruleId.replace("@typescript-eslint/", "")}`;
    }
  }

  // Semgrep rules
  if (tool === "semgrep") {
    return `https://semgrep.dev/r?q=${encodeURIComponent(ruleId)}`;
  }

  // Ruff rules
  if (tool === "ruff") {
    return `https://docs.astral.sh/ruff/rules/${ruleId}`;
  }

  // PMD rules
  if (tool === "pmd") {
    return `https://pmd.github.io/latest/pmd_rules_java.html`;
  }

  return null;
}

/**
 * Get a severity emoji for visual distinction.
 */
function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🔵";
    default:
      return "⚪";
  }
}

/**
 * Format a GitHub file link.
 */
function formatGitHubLink(
  repo: { owner: string; name: string; commit: string },
  location: { path: string; startLine: number; endLine?: number },
): string {
  const lineRange =
    location.endLine && location.endLine !== location.startLine
      ? `L${location.startLine}-L${location.endLine}`
      : `L${location.startLine}`;
  return `https://github.com/${repo.owner}/${repo.name}/blob/${repo.commit}/${location.path}#${lineRange}`;
}

/**
 * Generate the issue body for a finding.
 */
function generateIssueBody(finding: Finding, context: RunContext): string {
  const { repo, runNumber } = context;
  const timestamp = new Date().toISOString();
  const location = finding.locations[0];
  const severityEmoji = getSeverityEmoji(finding.severity);

  // Build location section with clickable GitHub links
  let locationSection = "";
  if (location) {
    const link = formatGitHubLink(repo, location);
    locationSection = `[**\`${location.path}\`**](${link}) (line ${location.startLine}${location.endLine && location.endLine !== location.startLine ? `-${location.endLine}` : ""})`;
  } else {
    locationSection = "Unknown location";
  }

  // Handle multiple locations - always show all, use collapsible for large lists
  let additionalLocations = "";
  let prioritizationHint = "";
  if (finding.locations.length > 1) {
    const otherLocations = finding.locations.slice(1);
    const locationLines = otherLocations.map((loc) => {
      const link = formatGitHubLink(repo, loc);
      return `- [\`${loc.path}\`](${link}) line ${loc.startLine}`;
    });

    if (otherLocations.length <= 10) {
      // Show inline for up to 10 additional locations
      additionalLocations = `\n\n**Additional locations (${otherLocations.length}):**\n${locationLines.join("\n")}`;
    } else {
      // Use collapsible section for more than 10 locations
      additionalLocations = `\n\n<details>\n<summary><strong>View all ${otherLocations.length} additional locations</strong></summary>\n\n${locationLines.join("\n")}\n</details>`;
    }

    // Add prioritization hint for large issues
    if (finding.locations.length >= 5) {
      const uniqueFiles = [...new Set(finding.locations.map((l) => l.path))];
      // Find the file with most occurrences
      const fileCounts = new Map<string, number>();
      for (const loc of finding.locations) {
        fileCounts.set(loc.path, (fileCounts.get(loc.path) || 0) + 1);
      }
      const sortedFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
      const topFile = sortedFiles[0];

      prioritizationHint = `\n\n> **💡 Where to start:** Focus on \`${topFile[0].split("/").pop()}\` first (${topFile[1]} occurrences). ${uniqueFiles.length > 3 ? `This issue spans ${uniqueFiles.length} files - consider fixing incrementally.` : ""}`;
    }
  }

  // Build evidence section (limit to first 3 snippets, max 50 lines each)
  let evidenceSection = "";
  if (finding.evidence?.snippet) {
    const snippets = finding.evidence.snippet.split("\n---\n");
    const limitedSnippets = snippets.slice(0, 3);
    const truncatedSnippets = limitedSnippets.map((s) => {
      const lines = s.split("\n");
      if (lines.length > 50) {
        return lines.slice(0, 50).join("\n") + "\n... (truncated)";
      }
      return s;
    });

    if (truncatedSnippets.length === 1) {
      evidenceSection = `\n## Code Sample\n\n\`\`\`\n${truncatedSnippets[0].trim()}\n\`\`\``;
    } else {
      const snippetContent = truncatedSnippets
        .map((s, i) => `**Sample ${i + 1}:**\n\`\`\`\n${s.trim()}\n\`\`\``)
        .join("\n\n");
      evidenceSection = `\n## Code Samples\n\n${snippetContent}`;
      if (snippets.length > 3) {
        evidenceSection += `\n\n*${snippets.length - 3} additional code samples omitted*`;
      }
    }
  }

  // Build suggested fix section - always generate one using templates
  const suggestedFix = finding.suggestedFix || getSuggestedFix(finding);
  let fixSection = "";
  if (suggestedFix) {
    fixSection = `\n## How to Fix\n\n**Goal:** ${suggestedFix.goal}\n\n**Steps:**\n${suggestedFix.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n**Done when:**\n${suggestedFix.acceptance.map((a) => `- [ ] ${a}`).join("\n")}`;
  }

  // Build rule documentation link
  // Handle merged rules (e.g., "MD036+MD034+MD040") - show individual links
  let ruleLink: string;
  if (finding.ruleId.includes("+")) {
    const rules = finding.ruleId.split("+");
    // Create individual links for each rule
    const ruleLinks = rules.map((r) => {
      const url = getRuleDocUrl(finding.tool, r);
      return url ? `[\`${r}\`](${url})` : `\`${r}\``;
    });
    ruleLink = ruleLinks.join(", ");
  } else {
    const ruleDocUrl = getRuleDocUrl(finding.tool, finding.ruleId);
    ruleLink = ruleDocUrl
      ? `[\`${finding.ruleId}\`](${ruleDocUrl})`
      : `\`${finding.ruleId}\``;
  }

  // Build evidence links section
  let referencesSection = "";
  if (finding.evidence?.links && finding.evidence.links.length > 0) {
    const linkList = finding.evidence.links
      .filter((l) => l && l.startsWith("http"))
      .map((l) => `- ${l}`)
      .join("\n");
    if (linkList) {
      referencesSection = `\n## References\n\n${linkList}`;
    }
  }

  // Determine issue description based on severity
  const severityDesc =
    finding.severity === "critical" || finding.severity === "high"
      ? "**This issue should be addressed soon.**"
      : "";

  const body = `${severityEmoji} **${finding.severity.toUpperCase()}** severity · ${finding.confidence} confidence · Effort: ${finding.effort}

${finding.message}

## Details

| Property | Value |
|----------|-------|
| Tool | \`${finding.tool}\` |
| Rule | ${ruleLink} |
| Layer | ${finding.layer} |
| Autofix | ${finding.autofix === "safe" ? "✅ Safe autofix available" : finding.autofix === "requires_review" ? "⚠️ Autofix requires review" : "Manual fix required"} |

${severityDesc}

## Location

${locationSection}${additionalLocations}${prioritizationHint}
${evidenceSection}
${fixSection}
${referencesSection}

---

<details>
<summary>Metadata (for automation)</summary>

- **Fingerprint:** \`${shortFingerprint(finding.fingerprint)}\`
- **Full fingerprint:** \`${finding.fingerprint}\`
- **Commit:** [\`${repo.commit.substring(0, 7)}\`](https://github.com/${repo.owner}/${repo.name}/commit/${repo.commit})
- **Run:** #${runNumber}
- **Generated:** ${timestamp}
- **Branch suggestion:** \`vibecop/fix-${shortFingerprint(finding.fingerprint)}\`

</details>

${generateFingerprintMarker(finding.fingerprint)}
${generateRunMetadataMarker(runNumber, timestamp)}
`;

  return body;
}

/**
 * Truncate text to max length, avoiding cutting mid-word.
 */
function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }

  // Find the last space before maxLen - 3 (to leave room for "...")
  const truncateAt = maxLen - 3;
  const lastSpace = text.lastIndexOf(" ", truncateAt);

  // If there's a space within a reasonable distance, cut there
  // Otherwise, cut at the limit (for single long words)
  if (lastSpace > truncateAt - 20 && lastSpace > 0) {
    return text.substring(0, lastSpace) + "...";
  }

  return text.substring(0, truncateAt) + "...";
}

function generateIssueTitle(finding: Finding): string {
  const maxLen = 100;

  // Build location hint based on number of unique files
  let locationHint = "";
  if (finding.locations.length > 0) {
    const uniqueFiles = [
      ...new Set(finding.locations.map((l) => l.path.split("/").pop())),
    ];
    if (uniqueFiles.length === 1) {
      locationHint = ` in ${uniqueFiles[0]}`;
    } else if (uniqueFiles.length <= 3) {
      // Show first file + count for small sets
      locationHint = ` in ${uniqueFiles[0]} +${uniqueFiles.length - 1} more`;
    }
    // For many files, omit location hint (title already says "X files")
  }

  const title = `[vibeCop] ${finding.title}${locationHint}`;
  return truncateAtWordBoundary(title, maxLen);
}

/**
 * Get labels for a finding.
 */
function getLabelsForFinding(finding: Finding, baseLabel: string): string[] {
  const labels = [
    baseLabel,
    `severity:${finding.severity}`,
    `confidence:${finding.confidence}`,
    `effort:${finding.effort}`,
    `layer:${finding.layer}`,
    `tool:${finding.tool}`,
  ];

  if (finding.autofix === "safe") {
    labels.push("autofix:safe");
  }

  // Add "demo" label for test-fixtures findings
  if (isTestFixtureFinding(finding)) {
    labels.push("demo");
  }

  return labels;
}

// ============================================================================
// Issue Orchestration
// ============================================================================

export interface IssueStats {
  created: number;
  updated: number;
  closed: number;
  skippedBelowThreshold: number;
  skippedDuplicate: number;
  skippedMaxReached: number;
}

/**
 * Process findings and create/update/close issues.
 */
export async function processFindings(
  findings: Finding[],
  context: RunContext,
): Promise<IssueStats> {
  const stats: IssueStats = {
    created: 0,
    updated: 0,
    closed: 0,
    skippedBelowThreshold: 0,
    skippedDuplicate: 0,
    skippedMaxReached: 0,
  };

  const repoInfo = parseGitHubRepository();
  if (!repoInfo) {
    console.error("GITHUB_REPOSITORY environment variable not set");
    return stats;
  }

  const { owner, repo } = repoInfo;
  const issuesConfig = {
    enabled: true,
    label: "vibeCop",
    max_new_per_run: 25,
    severity_threshold: "info" as const,
    confidence_threshold: "low" as const,
    close_resolved: false,
    ...context.config.issues,
  };

  console.log(
    `Issue thresholds: severity>=${issuesConfig.severity_threshold}, confidence>=${issuesConfig.confidence_threshold}`,
  );

  if (!issuesConfig.enabled) {
    console.log("Issue creation is disabled");
    return stats;
  }

  // Ensure labels exist
  console.log("Ensuring labels exist...");
  await ensureLabels(owner, repo, DEFAULT_LABELS);

  // Fetch existing issues
  console.log("Fetching existing vibeCop issues...");
  const existingIssues = await searchIssuesByLabel(owner, repo, [
    issuesConfig.label,
  ]);
  const fingerprintMap = buildFingerprintMap(existingIssues);
  console.log(`Found ${existingIssues.length} existing issues`);

  // Deduplicate findings
  const uniqueFindings = deduplicateFindings(findings);
  console.log(`Processing ${uniqueFindings.length} unique findings`);

  // Filter findings by threshold
  const actionableFindings = uniqueFindings.filter((finding) =>
    meetsThresholds(
      finding.severity,
      finding.confidence,
      issuesConfig.severity_threshold,
      issuesConfig.confidence_threshold,
    ),
  );

  stats.skippedBelowThreshold =
    uniqueFindings.length - actionableFindings.length;
  console.log(`${actionableFindings.length} findings meet thresholds`);

  // Track which fingerprints we've seen in this run
  const seenFingerprints = new Set<string>();

  // Build secondary lookups for fallback matching
  const toolRuleMap = new Map<string, ExistingIssue>();
  const sublinterMap = new Map<string, ExistingIssue>(); // For trunk sublinters

  for (const issue of existingIssues) {
    // Extract tool and rule from issue title like "[vibeCop] knip: files in ..."
    // Also handles "[vibeCop] yamllint: quoted-strings" and "[vibeCop] markdownlint (12 issues..."
    const titleMatch = issue.title.match(
      /\[vibeCop\]\s+(\w+)(?::\s+(\S+)|[\s(])/i,
    );
    if (titleMatch) {
      const toolOrSublinter = titleMatch[1].toLowerCase();
      const ruleId = titleMatch[2]?.toLowerCase();

      if (ruleId) {
        // Standard format: "[vibeCop] tool: ruleId ..."
        const key = `${toolOrSublinter}|${ruleId}`;
        if (!toolRuleMap.has(key)) {
          toolRuleMap.set(key, issue);
        }
      }

      // Also map by sublinter for trunk findings (yamllint, markdownlint, etc.)
      const sublinters = [
        "yamllint",
        "markdownlint",
        "checkov",
        "osv-scanner",
        "prettier",
      ];
      if (sublinters.includes(toolOrSublinter)) {
        const sublinterKey = `trunk|${toolOrSublinter}`;
        if (!sublinterMap.has(sublinterKey)) {
          sublinterMap.set(sublinterKey, issue);
        }
      }
    }
  }

  // Process each finding
  for (const finding of actionableFindings) {
    seenFingerprints.add(finding.fingerprint);

    // Try fingerprint match first
    let existingIssue = fingerprintMap.get(finding.fingerprint);

    if (!existingIssue) {
      // Fallback 1: check if there's an existing issue for same tool+rule
      const toolRuleKey = `${finding.tool.toLowerCase()}|${finding.ruleId.toLowerCase()}`;
      existingIssue = toolRuleMap.get(toolRuleKey);

      // Fallback 2: for trunk findings with merged rules, check by sublinter
      if (!existingIssue && finding.tool.toLowerCase() === "trunk") {
        // Extract sublinter from title (e.g., "yamllint (18 issues..." or "yamllint: quoted-strings")
        const sublinterMatch = finding.title.match(/^(\w+)[\s:(]/);
        if (sublinterMatch) {
          const sublinterKey = `trunk|${sublinterMatch[1].toLowerCase()}`;
          existingIssue = sublinterMap.get(sublinterKey);
        }
      }

      if (existingIssue) {
        console.log(
          `Found existing issue #${existingIssue.number} by fallback match`,
        );
        // Add to fingerprint map so we track it
        fingerprintMap.set(finding.fingerprint, existingIssue);
        // Mark the old fingerprint as seen to avoid closing it
        if (existingIssue.metadata?.fingerprint) {
          seenFingerprints.add(existingIssue.metadata.fingerprint);
        }
      }
    }

    if (existingIssue) {
      // Update existing issue (including title)
      if (existingIssue.state === "open") {
        console.log(
          `Updating issue #${existingIssue.number} for ${finding.ruleId}`,
        );
        const title = generateIssueTitle(finding);
        const body = generateIssueBody(finding, context);

        await withRateLimit(() =>
          updateIssue(owner, repo, {
            number: existingIssue!.number,
            title, // Update title too
            body,
            labels: getLabelsForFinding(finding, issuesConfig.label),
          }),
        );

        stats.updated++;
      }
      // If closed, don't reopen (would need explicit policy)
    } else {
      // Create new issue (respect max cap)
      if (stats.created >= issuesConfig.max_new_per_run) {
        stats.skippedMaxReached++;
        continue;
      }

      console.log(`Creating issue for ${finding.ruleId}`);
      const title = generateIssueTitle(finding);
      const body = generateIssueBody(finding, context);
      const labels = getLabelsForFinding(finding, issuesConfig.label);

      const issueNumber = await withRateLimit(() =>
        createIssue(owner, repo, {
          title,
          body,
          labels,
          assignees: issuesConfig.assignees,
        }),
      );

      console.log(`Created issue #${issueNumber}`);
      stats.created++;
    }
  }

  // Handle resolved issues (close if configured)
  if (issuesConfig.close_resolved) {
    await closeResolvedIssues(
      owner,
      repo,
      existingIssues,
      seenFingerprints,
      context.runNumber,
      stats,
    );

    // Also close issues that are superseded by merged findings
    await closeSupersededIssues(
      owner,
      repo,
      existingIssues,
      actionableFindings,
      seenFingerprints,
      stats,
    );

    // Close duplicate issues (same normalized title, keep only newest updated)
    await closeDuplicateIssues(owner, repo, existingIssues, stats);
  }

  return stats;
}

/**
 * Extract sublinter name from an issue title.
 * e.g., "[vibeCop] yamllint: quoted-strings" -> "yamllint"
 * e.g., "[vibeCop] markdownlint (12 issues..." -> "markdownlint"
 */
function extractSublinterFromTitle(title: string): string | null {
  // Match patterns like "[vibeCop] yamllint: ..." or "[vibeCop] yamllint (..."
  const match = title.match(/\[vibeCop\]\s+(\w+)[\s:(\-]/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Check if an issue is superseded by a merged finding.
 * An issue is superseded if:
 * 1. It's a trunk issue for a specific rule (e.g., "yamllint: quoted-strings")
 * 2. There's a current merged finding for the same sublinter (e.g., "yamllint (18 issues...)")
 * 3. The issue's fingerprint wasn't directly matched (meaning it's an old-style issue)
 */
function isSupersededByMergedFinding(
  issue: ExistingIssue,
  findings: Finding[],
  seenFingerprints: Set<string>,
): { superseded: boolean; supersededBy?: Finding } {
  // If this issue's fingerprint was seen, it's not superseded (it was updated)
  if (
    issue.metadata?.fingerprint &&
    seenFingerprints.has(issue.metadata.fingerprint)
  ) {
    return { superseded: false };
  }

  const issueSublinter = extractSublinterFromTitle(issue.title);
  if (!issueSublinter) {
    return { superseded: false };
  }

  // Check if this is an old-style single-rule issue (has a colon in the title)
  const isSingleRuleIssue = /\[vibeCop\]\s+\w+:\s+\S+/.test(issue.title);
  if (!isSingleRuleIssue) {
    return { superseded: false };
  }

  // Look for a merged finding for the same sublinter
  for (const finding of findings) {
    if (finding.tool !== "trunk") continue;

    // Check if this finding is a merged sublinter finding
    const findingSublinter = extractSublinterFromTitle(finding.title);
    if (findingSublinter !== issueSublinter) continue;

    // Check if the finding is a merged one (has multiple rules or "issues across")
    const isMergedFinding =
      finding.ruleId.includes("+") ||
      finding.title.includes("issues across") ||
      finding.title.includes("occurrences)");

    if (isMergedFinding) {
      return { superseded: true, supersededBy: finding };
    }
  }

  return { superseded: false };
}

/**
 * Close issues that are superseded by merged findings.
 */
async function closeSupersededIssues(
  owner: string,
  repo: string,
  existingIssues: ExistingIssue[],
  findings: Finding[],
  seenFingerprints: Set<string>,
  stats: IssueStats,
): Promise<void> {
  for (const issue of existingIssues) {
    if (issue.state !== "open") continue;

    const { superseded, supersededBy } = isSupersededByMergedFinding(
      issue,
      findings,
      seenFingerprints,
    );

    if (superseded && supersededBy) {
      console.log(
        `Closing issue #${issue.number} (superseded by merged finding: ${supersededBy.title})`,
      );

      await withRateLimit(() =>
        closeIssue(
          owner,
          repo,
          issue.number,
          `🔄 This issue has been superseded by a consolidated issue that groups all related findings together.\n\nThe individual findings are now tracked in a single merged issue for better organization.\n\nClosed automatically by vibeCop.`,
        ),
      );

      stats.closed++;
    }
  }
}

/**
 * Normalize an issue title for duplicate detection.
 * Removes occurrence counts and normalizes whitespace.
 * e.g., "[vibeCop] Duplicate Code: 22 lines (126 occurrences)" -> "duplicate code: 22 lines"
 */
function normalizeIssueTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[vibecop\]\s*/i, "") // Remove [vibeCop] prefix
    .replace(/\s*\(\d+\s*occurrences?\)/gi, "") // Remove occurrence counts
    .replace(/\s+in\s+\S+$/, "") // Remove "in filename" suffix
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Close duplicate issues, keeping only the one most recently updated.
 */
async function closeDuplicateIssues(
  owner: string,
  repo: string,
  existingIssues: ExistingIssue[],
  stats: IssueStats,
): Promise<void> {
  // Group open issues by normalized title
  const issuesByTitle = new Map<string, ExistingIssue[]>();

  for (const issue of existingIssues) {
    if (issue.state !== "open") continue;

    const normalizedTitle = normalizeIssueTitle(issue.title);
    const existing = issuesByTitle.get(normalizedTitle);
    if (existing) {
      existing.push(issue);
    } else {
      issuesByTitle.set(normalizedTitle, [issue]);
    }
  }

  // Close duplicates (keep the highest numbered one, which is most recent)
  for (const [normalizedTitle, issues] of issuesByTitle.entries()) {
    if (issues.length <= 1) continue;

    // Sort by issue number descending (highest = most recent)
    issues.sort((a, b) => b.number - a.number);

    // Keep the first one (highest number), close the rest
    const keepIssue = issues[0];
    const duplicates = issues.slice(1);

    console.log(
      `Found ${duplicates.length} duplicate(s) of "${normalizedTitle}", keeping #${keepIssue.number}`,
    );

    for (const dup of duplicates) {
      console.log(`Closing duplicate issue #${dup.number}`);

      await withRateLimit(() =>
        closeIssue(
          owner,
          repo,
          dup.number,
          `🔄 This is a duplicate issue. The same finding is tracked in #${keepIssue.number}.\n\nClosed automatically by vibeCop.`,
        ),
      );

      stats.closed++;
    }
  }
}

/**
 * Close issues that are no longer detected (with flap protection).
 */
async function closeResolvedIssues(
  owner: string,
  repo: string,
  existingIssues: ExistingIssue[],
  seenFingerprints: Set<string>,
  currentRun: number,
  stats: IssueStats,
): Promise<void> {
  for (const issue of existingIssues) {
    if (issue.state !== "open") continue;
    if (!issue.metadata?.fingerprint) continue;

    // Check if this fingerprint was seen in the current run
    if (seenFingerprints.has(issue.metadata.fingerprint)) {
      continue;
    }

    // Calculate consecutive misses
    const lastSeenRun = issue.metadata.lastSeenRun || 0;
    const consecutiveMisses = currentRun - lastSeenRun;

    if (consecutiveMisses >= FLAP_PROTECTION_RUNS) {
      console.log(
        `Closing issue #${issue.number} (not seen for ${consecutiveMisses} runs)`,
      );

      await withRateLimit(() =>
        closeIssue(
          owner,
          repo,
          issue.number,
          `🎉 This issue appears to be resolved! The finding has not been detected for ${consecutiveMisses} consecutive runs.\n\nClosed automatically by vibeCop.`,
        ),
      );

      stats.closed++;
    } else {
      // Update the issue with a note that it wasn't detected
      await withRateLimit(() =>
        addIssueComment(
          owner,
          repo,
          issue.number,
          `ℹ️ This finding was not detected in run #${currentRun}. If it remains undetected for ${FLAP_PROTECTION_RUNS - consecutiveMisses} more run(s), this issue will be automatically closed.`,
        ),
      );
    }
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const findingsPath = args[0] || "findings.json";
  const contextPath = args[1] || "context.json";

  // Load findings
  if (!existsSync(findingsPath)) {
    console.error(`Findings file not found: ${findingsPath}`);
    process.exit(1);
  }

  const findings: Finding[] = JSON.parse(readFileSync(findingsPath, "utf-8"));
  console.log(`Loaded ${findings.length} findings`);

  // Load context
  if (!existsSync(contextPath)) {
    console.error(`Context file not found: ${contextPath}`);
    process.exit(1);
  }

  const context: RunContext = JSON.parse(readFileSync(contextPath, "utf-8"));

  // Process findings
  const stats = await processFindings(findings, context);

  // Output summary
  console.log("\n=== Issue Processing Summary ===");
  console.log(`Created: ${stats.created}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Closed: ${stats.closed}`);
  console.log(`Skipped (below threshold): ${stats.skippedBelowThreshold}`);
  console.log(`Skipped (max reached): ${stats.skippedMaxReached}`);
  console.log(`Skipped (duplicate): ${stats.skippedDuplicate}`);

  // Set output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    const output = [
      `issues_created=${stats.created}`,
      `issues_updated=${stats.updated}`,
      `issues_closed=${stats.closed}`,
    ].join("\n");

    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, output + "\n");
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Error processing findings:", err);
    process.exit(1);
  });
}
