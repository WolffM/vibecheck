/**
 * ADO Work Item Formatter
 *
 * Generates ADO work item title + HTML description from vibecheck findings.
 * Parallel to src/output/issue-formatter.ts but outputs HTML (ADO uses HTML, not markdown).
 */

import {
  shortFingerprint,
  isTestFixtureFinding,
} from "../utils/fingerprints.js";
import { getSuggestedFix } from "../utils/fix-templates.js";
import { getRuleDocUrl } from "../utils/rule-docs.js";
import {
  getSeverityEmoji,
  getLanguageFromPath,
  getToolLanguage,
} from "../utils/shared.js";
import { type Finding, type RunContext } from "../core/types.js";
import { truncateAtWordBoundary } from "./issue-formatter.js";

// Re-export shared helpers
export { truncateAtWordBoundary };

// ============================================================================
// Work Item Title
// ============================================================================

/**
 * Generate work item title — same format as GitHub issues.
 */
export function generateWorkItemTitle(finding: Finding): string {
  const maxLen = 100;

  let locationHint = "";
  if (finding.locations.length > 0) {
    const uniqueFiles = [
      ...new Set(finding.locations.map((l) => l.path.split("/").pop())),
    ];
    const titleLower = finding.title.toLowerCase();
    const titleAlreadyHasFile = uniqueFiles.some(
      (f) => f && titleLower.includes(f.toLowerCase()),
    );

    if (!titleAlreadyHasFile) {
      if (uniqueFiles.length === 1) {
        locationHint = ` in ${uniqueFiles[0]}`;
      } else if (uniqueFiles.length <= 3) {
        locationHint = ` in ${uniqueFiles[0]} +${uniqueFiles.length - 1} more`;
      }
    }
  }

  const title = `[vibeCheck] ${finding.title}${locationHint}`;
  return truncateAtWordBoundary(title, maxLen);
}

// ============================================================================
// Work Item Tags
// ============================================================================

/**
 * Get tags for a work item (ADO uses semicolon-separated tags, not label objects).
 */
export function getTagsForFinding(
  finding: Finding,
  baseTag: string = "vibeCheck",
  languagesInRun?: Set<string>,
): string[] {
  const tags = [
    baseTag,
    `severity:${finding.severity}`,
    `layer:${finding.layer}`,
    `tool:${finding.tool}`,
  ];

  if (finding.autofix === "safe") {
    tags.push("autofix:safe");
  }

  if (languagesInRun && languagesInRun.size > 1) {
    let lang = getToolLanguage(finding.tool);
    if (!lang && finding.locations.length > 0) {
      const langCounts: Record<string, number> = {};
      for (const loc of finding.locations) {
        const l = getLanguageFromPath(loc.path, true);
        if (l) langCounts[l] = (langCounts[l] || 0) + 1;
      }
      const entries = Object.entries(langCounts);
      if (entries.length === 1) lang = entries[0][0];
    }
    if (lang) tags.push(`lang:${lang}`);
  }

  if (isTestFixtureFinding(finding)) {
    tags.push("demo");
  }

  return tags;
}

// ============================================================================
// Work Item Description (HTML)
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the code sample section as HTML.
 */
function buildEvidenceHtml(finding: Finding): string {
  if (!finding.evidence?.snippet) return "";

  const snippets = finding.evidence.snippet.split("\n---\n");
  const limited = snippets.slice(0, 3);

  const blocks = limited.map((s, i) => {
    const trimmed = s.trim();
    const lines = trimmed.split("\n");
    const content = lines.length > 50
      ? lines.slice(0, 50).join("\n") + "\n... (truncated)"
      : trimmed;

    const loc = finding.locations[i] || finding.locations[0];
    const header = loc ? `<strong>📄 ${escapeHtml(loc.path)}:${loc.startLine}</strong><br/>` : "";

    return `${header}<pre><code>${escapeHtml(content)}</code></pre>`;
  });

  const title = blocks.length === 1 ? "Code Sample" : "Code Samples";
  return `<h3>${title}</h3>${blocks.join("<br/>")}`;
}

/**
 * Build the references section as HTML.
 */
function buildReferencesHtml(finding: Finding): string {
  if (!finding.evidence?.links || finding.evidence.links.length === 0) return "";

  const urls = [...new Set(finding.evidence.links.filter((l) => l?.startsWith("http")))];
  if (urls.length === 0) return "";

  const items = urls.slice(0, 10).map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`);
  return `<h3>References</h3><ul>${items.join("")}</ul>`;
}

/**
 * Build rule documentation link.
 */
function buildRuleLink(finding: Finding): string {
  if (finding.ruleId.includes("+")) {
    const rules = finding.ruleId.split("+");
    return rules.map((r) => {
      const url = getRuleDocUrl(finding.tool, r);
      return url ? `<a href="${escapeHtml(url)}">${escapeHtml(r)}</a>` : escapeHtml(r);
    }).join(", ");
  }

  const url = getRuleDocUrl(finding.tool, finding.ruleId);
  return url ? `<a href="${escapeHtml(url)}">${escapeHtml(finding.ruleId)}</a>` : escapeHtml(finding.ruleId);
}

/**
 * Build CWE link if applicable.
 */
function buildCweHtml(finding: Finding): string {
  if (finding.layer !== "security") return "";
  const cweLabel = finding.labels.find((l) => l.startsWith("cwe:"));
  if (!cweLabel) return "";
  const cweId = cweLabel.replace("cwe:", "");
  return `<tr><td><strong>CWE</strong></td><td><a href="https://cwe.mitre.org/data/definitions/${cweId}.html">CWE-${cweId}</a></td></tr>`;
}

/**
 * Build suggested fix HTML (security findings).
 */
function buildSuggestedFixHtml(finding: Finding): string {
  if (finding.layer !== "security") return "";
  const fix = getSuggestedFix(finding);
  const steps = fix.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  return `<h3>Suggested Fix</h3><p><strong>Goal:</strong> ${escapeHtml(fix.goal)}</p><ol>${steps}</ol>`;
}

/**
 * Generate the full HTML description for an ADO work item.
 */
export function generateWorkItemDescription(
  finding: Finding,
  context: RunContext,
): string {
  const { runNumber } = context;
  const timestamp = new Date().toISOString();
  const severityEmoji = getSeverityEmoji(finding.severity);

  const ruleLink = buildRuleLink(finding);
  const cweRow = buildCweHtml(finding);
  const evidenceHtml = buildEvidenceHtml(finding);
  const referencesHtml = buildReferencesHtml(finding);
  const suggestedFixHtml = buildSuggestedFixHtml(finding);

  const autofixText =
    finding.autofix === "safe"
      ? "✅ Safe autofix available"
      : finding.autofix === "requires_review"
        ? "⚠️ Autofix requires review"
        : "Manual fix required";

  // Location section
  let locationHtml = "";
  if (finding.locations.length > 0) {
    const loc = finding.locations[0];
    const lineInfo = loc.endLine && loc.endLine !== loc.startLine
      ? `${loc.startLine}-${loc.endLine}`
      : `${loc.startLine}`;
    locationHtml = `<h3>Location</h3><p><strong>${escapeHtml(loc.path)}</strong> (line ${lineInfo})</p>`;

    if (finding.locations.length > 1) {
      const others = finding.locations.slice(1);
      const items = others.map((l) => `<li>${escapeHtml(l.path)} line ${l.startLine}</li>`);
      locationHtml += `<p><strong>Additional locations (${others.length}):</strong></p><ul>${items.join("")}</ul>`;
    }
  }

  return `
<h2>Details</h2>
<table>
  <tr><td><strong>Severity</strong></td><td>${severityEmoji} ${finding.severity.toUpperCase()}</td></tr>
  <tr><td><strong>Confidence</strong></td><td>${finding.confidence}</td></tr>
  <tr><td><strong>Tool</strong></td><td>${escapeHtml(finding.tool)}</td></tr>
  <tr><td><strong>Rule</strong></td><td>${ruleLink}</td></tr>
  <tr><td><strong>Layer</strong></td><td>${finding.layer}</td></tr>
  <tr><td><strong>Autofix</strong></td><td>${autofixText}</td></tr>
  ${cweRow}
</table>

<p>${escapeHtml(finding.message)}</p>

${locationHtml}
${evidenceHtml}
${suggestedFixHtml}
${referencesHtml}

<hr/>
<details>
  <summary>Metadata</summary>
  <ul>
    <li><strong>Fingerprint:</strong> ${shortFingerprint(finding.fingerprint)}</li>
    <li><strong>Full fingerprint:</strong> ${finding.fingerprint}</li>
    <li><strong>Run:</strong> #${runNumber}</li>
    <li><strong>Generated:</strong> ${timestamp}</li>
  </ul>
</details>

<!-- vibecheck:fingerprint:${finding.fingerprint} -->
<!-- vibecheck:run:${runNumber} -->
<!-- vibecheck:ai:tool=${finding.tool} -->
<!-- vibecheck:ai:rule=${finding.ruleId} -->
<!-- vibecheck:ai:severity=${finding.severity} -->
<!-- vibecheck:ai:layer=${finding.layer} -->
<!-- vibecheck:ai:files=${finding.locations.map((l) => l.path).join(",")} -->
`.trim();
}
