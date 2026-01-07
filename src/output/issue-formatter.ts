/**
 * Issue Formatter
 *
 * Pure functions for generating GitHub issue content from findings.
 */

import {
  generateFingerprintMarker,
  generateRunMetadataMarker,
  shortFingerprint,
} from "../utils/fingerprints.js";
import { getSuggestedFix } from "../utils/fix-templates.js";
import { getRuleDocUrl } from "../utils/rule-docs.js";
import type { Finding, RunContext } from "../core/types.js";

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

/** File extension to language mapping (comprehensive for syntax highlighting) */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  java: "java",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  sh: "bash",
  bash: "bash",
  md: "markdown",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  cpp: "cpp",
  c: "c",
  sql: "sql",
  xml: "xml",
  html: "html",
  css: "css",
};

/** Languages that we track for labeling (subset of all languages) */
const TRACKED_LANGUAGES = new Set(["typescript", "javascript", "python", "java"]);

/**
 * Get language from file extension.
 * @param path - File path to analyze
 * @param forLabeling - If true, only returns tracked languages (typescript/python/java)
 *                      If false, returns syntax highlighting language
 */
function getLanguageFromPath(path: string, forLabeling = false): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const lang = EXT_TO_LANGUAGE[ext || ""];
  
  if (!lang) return null;
  
  if (forLabeling) {
    // For labeling, normalize js to typescript and only return tracked languages
    const normalizedLang = lang === "javascript" ? "typescript" : lang;
    return TRACKED_LANGUAGES.has(normalizedLang) ? normalizedLang : null;
  }
  
  return lang;
}

/**
 * Infer programming language from file path for syntax highlighting.
 * @deprecated Use getLanguageFromPath(path, false) instead
 */
function inferLanguageFromPath(path?: string): string {
  if (!path) return "";
  return getLanguageFromPath(path, false) || "";
}

/**
 * Format a URL into a readable link title.
 */
function formatLinkTitle(url: string): string {
  // CWE links
  const cweMatch = url.match(/cwe\.mitre\.org\/data\/definitions\/(\d+)/);
  if (cweMatch) return `CWE-${cweMatch[1]}`;

  // Bandit docs
  if (url.includes("bandit.readthedocs.io")) {
    const ruleMatch = url.match(/plugins\/([^/]+)/);
    return ruleMatch
      ? `Bandit ${ruleMatch[1].toUpperCase()}`
      : "Bandit Documentation";
  }

  // GitHub advisories
  if (url.includes("github.com/advisories/GHSA")) {
    const ghsaMatch = url.match(/GHSA-[\w-]+/);
    return ghsaMatch ? ghsaMatch[0] : "GitHub Advisory";
  }

  // Semgrep rules
  if (url.includes("semgrep.dev")) return "Semgrep Rule";

  // OWASP
  if (url.includes("owasp.org")) return "OWASP Reference";

  // Generic: use domain
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    return domain;
  } catch {
    return url.length > 40 ? url.substring(0, 40) + "..." : url;
  }
}

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

  const title = `[vibeCheck] ${finding.title}${locationHint}`;
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
 * Get the dominant language from a finding's locations.
 * Returns the language that appears most frequently, or null if mixed/unknown.
 */
function getDominantLanguageFromLocations(
  locations: { path: string }[],
): string | null {
  const langCounts: Record<string, number> = {};

  for (const loc of locations) {
    const lang = getLanguageFromPath(loc.path, true); // Use labeling mode
    if (lang) {
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
  }

  const entries = Object.entries(langCounts);
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0][0];

  // Return the most common language if it's dominant (>50%)
  const total = locations.length;
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] > total / 2) {
    return sorted[0][0];
  }

  return null; // Mixed languages
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
 * @param baseLabel - The base label (e.g., "vibeCheck")
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
    `layer:${finding.layer}`,
    `tool:${finding.tool}`,
  ];

  if (finding.autofix === "safe") {
    labels.push("autofix:safe");
  }

  // Add language label only when multiple languages have findings
  if (languagesInRun && languagesInRun.size > 1) {
    // First try tool-specific language, then infer from file extensions
    let lang = getToolLanguage(finding.tool);
    if (!lang && finding.locations.length > 0) {
      lang = getDominantLanguageFromLocations(finding.locations);
    }
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
 * Includes file path context and syntax highlighting.
 * Uses consistent header format: "📄 path/to/file.ext:lineNumber"
 */
function buildEvidenceSection(finding: Finding): string {
  if (!finding.evidence?.snippet) {
    return "";
  }

  const snippets = finding.evidence.snippet.split("\n---\n");
  const limitedSnippets = snippets.slice(0, 3);

  // Get language for syntax highlighting from first location
  const primaryLoc = finding.locations[0];
  const language = inferLanguageFromPath(primaryLoc?.path);

  const formattedSnippets = limitedSnippets.map((s, index) => {
    const trimmedSnippet = s.trim();
    const lines = trimmedSnippet.split("\n");
    const content =
      lines.length > 50
        ? lines.slice(0, 50).join("\n") + "\n... (truncated)"
        : trimmedSnippet;

    // Check if snippet already has embedded file context (from merged findings)
    // This happens when findings are merged and snippets already have "📄 path:line" headers
    const hasEmbeddedContext = trimmedSnippet.startsWith("📄 ");

    // Get location for this snippet (fall back to first if not available)
    const loc = finding.locations[index] || primaryLoc;

    // Build consistent file header: "📄 path/to/file.ext:line"
    // Skip if snippet already has embedded context to avoid duplication
    let fileHeader = "";
    if (loc && !hasEmbeddedContext) {
      const lineInfo =
        loc.endLine && loc.endLine !== loc.startLine
          ? `${loc.startLine}-${loc.endLine}`
          : `${loc.startLine}`;
      fileHeader = `📄 ${loc.path}:${lineInfo}\n`;
    }

    return `\`\`\`${language}\n${fileHeader}${content}\n\`\`\``;
  });

  if (formattedSnippets.length === 1) {
    return `\n## Code Sample\n\n${formattedSnippets[0]}`;
  }

  const snippetContent = formattedSnippets
    .map((s, i) => `**Sample ${i + 1}:**\n${s}`)
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
 * Formats URLs as readable markdown links and deduplicates them.
 * Limits to 10 visible references with a collapsible section for more.
 */
function buildReferencesSection(finding: Finding): string {
  if (!finding.evidence?.links || finding.evidence.links.length === 0) {
    return "";
  }

  // Deduplicate URLs while preserving order
  const uniqueUrls = [...new Set(finding.evidence.links.filter((l) => l && l.startsWith("http")))];

  if (uniqueUrls.length === 0) {
    return "";
  }

  const MAX_VISIBLE_REFS = 10;

  if (uniqueUrls.length <= MAX_VISIBLE_REFS) {
    const linkList = uniqueUrls
      .map((url) => `- [${formatLinkTitle(url)}](${url})`)
      .join("\n");
    return `\n## References\n\n${linkList}`;
  }

  // Show first 10, put rest in collapsible
  const visibleLinks = uniqueUrls.slice(0, MAX_VISIBLE_REFS);
  const hiddenLinks = uniqueUrls.slice(MAX_VISIBLE_REFS);

  const visibleList = visibleLinks
    .map((url) => `- [${formatLinkTitle(url)}](${url})`)
    .join("\n");

  const hiddenList = hiddenLinks
    .map((url) => `- [${formatLinkTitle(url)}](${url})`)
    .join("\n");

  return `\n## References\n\n${visibleList}\n\n<details>\n<summary>View ${hiddenLinks.length} more references</summary>\n\n${hiddenList}\n</details>`;
}

/**
 * Build CWE row for the details table (security layer only).
 */
function buildCweRow(finding: Finding): string {
  if (finding.layer !== "security") return "";

  const cweLabel = finding.labels.find((l) => l.startsWith("cwe:"));
  if (!cweLabel) return "";

  const cweId = cweLabel.replace("cwe:", "");
  return `| CWE | [\`CWE-${cweId}\`](https://cwe.mitre.org/data/definitions/${cweId}.html) |\n`;
}

/**
 * Build suggested fix section (security layer only).
 * Leverages fix-templates.ts for tool-specific guidance.
 */
function buildSuggestedFixSection(finding: Finding): string {
  if (finding.layer !== "security") return "";

  const fix = getSuggestedFix(finding);
  const steps = fix.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  return `
## Suggested Fix

**Goal:** ${fix.goal}

**Steps:**
${steps}
`;
}

/**
 * Build machine-readable metadata markers for AI agents.
 */
function buildAIMetadataMarkers(finding: Finding): string {
  const markers = [
    `<!-- vibecheck:ai:tool=${finding.tool} -->`,
    `<!-- vibecheck:ai:rule=${finding.ruleId} -->`,
    `<!-- vibecheck:ai:severity=${finding.severity} -->`,
    `<!-- vibecheck:ai:layer=${finding.layer} -->`,
    `<!-- vibecheck:ai:files=${finding.locations.map((l) => l.path).join(",")} -->`,
  ];

  // Add CWE for security findings
  const cweLabel = finding.labels.find((l) => l.startsWith("cwe:"));
  if (cweLabel) {
    markers.push(
      `<!-- vibecheck:ai:cwe=CWE-${cweLabel.replace("cwe:", "")} -->`,
    );
  }

  return markers.join("\n");
}

/**
 * Check if the message already contains location information (from merged findings).
 */
function messageContainsLocations(message: string): boolean {
  // Merged findings have messages like:
  // - "Found X occurrences across Y files:" (multiple files)
  // - "Found X occurrences in filename:" (single file)
  // Both are followed by bullet points with locations
  return /Found \d+ occurrences? (across \d+ files|in [^:]+):/i.test(message);
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
  const evidenceSection = buildEvidenceSection(finding);
  const ruleLink = buildRuleLink(finding);
  const referencesSection = buildReferencesSection(finding);
  const cweRow = buildCweRow(finding);
  const suggestedFixSection = buildSuggestedFixSection(finding);
  const aiMarkers = buildAIMetadataMarkers(finding);

  const autofixText =
    finding.autofix === "safe"
      ? "✅ Safe autofix available"
      : finding.autofix === "requires_review"
        ? "⚠️ Autofix requires review"
        : "Manual fix required";

  // Skip the Location section if the message already contains location info (merged findings)
  let locationSection = "";
  if (!messageContainsLocations(finding.message)) {
    const { mainLocation, additionalLocations } = buildLocationSection(
      finding,
      repo,
    );
    locationSection = `\n## Location\n\n${mainLocation}${additionalLocations}`;
  }

  const body = `## Details

| Property | Value |
|----------|-------|
| Severity | ${severityEmoji} ${finding.severity.toUpperCase()} |
| Confidence | ${finding.confidence} |
| Tool | \`${finding.tool}\` |
| Rule | ${ruleLink} |
| Layer | ${finding.layer} |
| Autofix | ${autofixText} |
${cweRow}
${finding.message}
${locationSection}
${evidenceSection}
${suggestedFixSection}
${referencesSection}

---

<details>
<summary>Metadata</summary>

- **Fingerprint:** \`${shortFingerprint(finding.fingerprint)}\`
- **Full fingerprint:** \`${finding.fingerprint}\`
- **Commit:** [\`${repo.commit.substring(0, 7)}\`](https://github.com/${repo.owner}/${repo.name}/commit/${repo.commit})
- **Run:** #${runNumber}
- **Generated:** ${timestamp}
- **Branch suggestion:** \`vibecheck/fix-${shortFingerprint(finding.fingerprint)}\`

</details>

${generateFingerprintMarker(finding.fingerprint)}
${generateRunMetadataMarker(runNumber, timestamp)}
${aiMarkers}
`;

  return body;
}
