/**
 * Issue Formatter
 *
 * Pure functions for generating GitHub issue content from findings.
 */

import {
  generateFingerprintMarker,
  generateRunMetadataMarker,
  shortFingerprint,
} from "./fingerprints.js";
import { getRuleDocUrl } from "./rule-docs.js";
import type { Finding, RunContext } from "./types.js";

// ============================================================================
// Severity Display
// ============================================================================

/**
 * Get a severity emoji for visual distinction.
 */
export function getSeverityEmoji(severity: string): string {
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

// ============================================================================
// GitHub Link Formatting
// ============================================================================

/**
 * Format a GitHub file link.
 */
export function formatGitHubLink(
  repo: { owner: string; name: string; commit: string },
  location: { path: string; startLine: number; endLine?: number },
): string {
  const lineRange =
    location.endLine && location.endLine !== location.startLine
      ? `L${location.startLine}-L${location.endLine}`
      : `L${location.startLine}`;
  return `https://github.com/${repo.owner}/${repo.name}/blob/${repo.commit}/${location.path}#${lineRange}`;
}

// ============================================================================
// Text Utilities
// ============================================================================

/**
 * Truncate text to max length, avoiding cutting mid-word.
 */
export function truncateAtWordBoundary(text: string, maxLen: number): string {
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

// ============================================================================
// Issue Title
// ============================================================================

/**
 * Generate the issue title for a finding.
 */
export function generateIssueTitle(finding: Finding): string {
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

// ============================================================================
// Issue Labels
// ============================================================================

/**
 * Map tool name to language for labeling.
 * Returns null for tools that work across languages (semgrep, trunk, jscpd).
 */
export function getToolLanguage(tool: string): string | null {
  const toolLower = tool.toLowerCase();

  // TypeScript/JavaScript tools
  if (["tsc", "eslint", "dependency-cruiser", "knip"].includes(toolLower)) {
    return "typescript";
  }

  // Python tools
  if (["ruff", "mypy", "bandit"].includes(toolLower)) {
    return "python";
  }

  // Java tools
  if (["pmd", "spotbugs"].includes(toolLower)) {
    return "java";
  }

  // Multi-language tools return null
  return null;
}

/**
 * Detect which languages have findings in a set of findings.
 * Returns a set of language names (typescript, python, java).
 */
export function detectLanguagesInFindings(findings: Finding[]): Set<string> {
  const languages = new Set<string>();

  for (const finding of findings) {
    const lang = getToolLanguage(finding.tool);
    if (lang) {
      languages.add(lang);
    }
  }

  return languages;
}

/**
 * Get labels for a finding.
 * @param finding - The finding to label
 * @param baseLabel - The base label (e.g., "vibeCop")
 * @param languagesInRun - Set of languages detected in this run (for conditional lang: labels)
 */
export function getLabelsForFinding(
  finding: Finding,
  baseLabel: string,
  languagesInRun?: Set<string>,
): string[] {
  const labels = [
    baseLabel,
    `severity:${finding.severity}`,
    `effort:${finding.effort}`,
    `layer:${finding.layer}`,
    `tool:${finding.tool}`,
  ];

  if (finding.autofix === "safe") {
    labels.push("autofix:safe");
  }

  // Add language label only when multiple languages have findings
  if (languagesInRun && languagesInRun.size > 1) {
    const lang = getToolLanguage(finding.tool);
    if (lang) {
      labels.push(`lang:${lang}`);
    }
  }

  return labels;
}

// ============================================================================
// Issue Body
// ============================================================================

/**
 * Build the location section with clickable GitHub links.
 */
function buildLocationSection(
  finding: Finding,
  repo: { owner: string; name: string; commit: string },
): {
  mainLocation: string;
  additionalLocations: string;
} {
  const location = finding.locations[0];

  // Build main location
  let mainLocation: string;
  if (location) {
    const link = formatGitHubLink(repo, location);
    mainLocation = `[**\`${location.path}\`**](${link}) (line ${location.startLine}${location.endLine && location.endLine !== location.startLine ? `-${location.endLine}` : ""})`;
  } else {
    mainLocation = "Unknown location";
  }

  // Handle multiple locations - always show all, use collapsible for large lists
  let additionalLocations = "";

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
  }

  return { mainLocation, additionalLocations };
}

/**
 * Build the evidence section with code samples.
 */
function buildEvidenceSection(finding: Finding): string {
  if (!finding.evidence?.snippet) {
    return "";
  }

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
    return `\n## Code Sample\n\n\`\`\`\n${truncatedSnippets[0].trim()}\n\`\`\``;
  }

  const snippetContent = truncatedSnippets
    .map((s, i) => `**Sample ${i + 1}:**\n\`\`\`\n${s.trim()}\n\`\`\``)
    .join("\n\n");
  let section = `\n## Code Samples\n\n${snippetContent}`;
  if (snippets.length > 3) {
    section += `\n\n*${snippets.length - 3} additional code samples omitted*`;
  }
  return section;
}

/**
 * Build the rule documentation link.
 */
function buildRuleLink(finding: Finding): string {
  // Handle merged rules (e.g., "MD036+MD034+MD040") - show individual links
  if (finding.ruleId.includes("+")) {
    const rules = finding.ruleId.split("+");
    const ruleLinks = rules.map((r) => {
      const url = getRuleDocUrl(finding.tool, r);
      return url ? `[\`${r}\`](${url})` : `\`${r}\``;
    });
    return ruleLinks.join(", ");
  }

  const ruleDocUrl = getRuleDocUrl(finding.tool, finding.ruleId);
  return ruleDocUrl
    ? `[\`${finding.ruleId}\`](${ruleDocUrl})`
    : `\`${finding.ruleId}\``;
}

/**
 * Build the references section with evidence links.
 */
function buildReferencesSection(finding: Finding): string {
  if (!finding.evidence?.links || finding.evidence.links.length === 0) {
    return "";
  }

  const linkList = finding.evidence.links
    .filter((l) => l && l.startsWith("http"))
    .map((l) => `- ${l}`)
    .join("\n");

  return linkList ? `\n## References\n\n${linkList}` : "";
}

/**
 * Generate the issue body for a finding.
 */
export function generateIssueBody(
  finding: Finding,
  context: RunContext,
): string {
  const { repo, runNumber } = context;
  const timestamp = new Date().toISOString();
  const severityEmoji = getSeverityEmoji(finding.severity);

  // Build sections
  const { mainLocation, additionalLocations } =
    buildLocationSection(finding, repo);
  const evidenceSection = buildEvidenceSection(finding);
  const ruleLink = buildRuleLink(finding);
  const referencesSection = buildReferencesSection(finding);

  const body = `## Details

| Property | Value |
|----------|-------|
| Severity | ${severityEmoji} ${finding.severity.toUpperCase()} |
| Confidence | ${finding.confidence} |
| Effort | ${finding.effort} |
| Tool | \`${finding.tool}\` |
| Rule | ${ruleLink} |
| Layer | ${finding.layer} |
| Autofix | ${finding.autofix === "safe" ? "✅ Safe autofix available" : finding.autofix === "requires_review" ? "⚠️ Autofix requires review" : "Manual fix required"} |

${finding.message}

## Location

${mainLocation}${additionalLocations}
${evidenceSection}
${referencesSection}

---

<details>
<summary>Metadata</summary>

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
