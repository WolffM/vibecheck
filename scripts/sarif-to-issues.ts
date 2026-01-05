/**
 * SARIF to Issues Converter
 *
 * Creates and updates GitHub issues from findings with deduplication,
 * rate limiting, and flap protection.
 *
 * Reference: vibeCop_spec.md section 8
 */

import { readFileSync, existsSync } from "node:fs";
import {
  deduplicateFindings,
  FLAP_PROTECTION_RUNS,
  generateFingerprintMarker,
  generateRunMetadataMarker,
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
 * Generate the issue body for a finding.
 */
function generateIssueBody(finding: Finding, context: RunContext): string {
  const { repo, runNumber } = context;
  const timestamp = new Date().toISOString();
  const location = finding.locations[0];

  const locationStr = location
    ? `\`${location.path}\` (line ${location.startLine}${location.endLine && location.endLine !== location.startLine ? `-${location.endLine}` : ""})`
    : "Unknown location";

  const evidenceSection = finding.evidence?.snippet
    ? `
## Evidence

\`\`\`
${finding.evidence.snippet}
\`\`\`
`
    : "";

  const suggestedFix = finding.suggestedFix;
  const fixSection = suggestedFix
    ? `
## Suggested Fix

**Goal:** ${suggestedFix.goal}

**Steps:**
${suggestedFix.steps.map((s) => `1. ${s}`).join("\n")}

**Acceptance Criteria:**
${suggestedFix.acceptance.map((a) => `- [ ] ${a}`).join("\n")}
`
    : "";

  const agentHint = context.config.llm?.agent_hint || "codex";
  const branchPrefix = context.config.llm?.pr_branch_prefix || "vibecop/";

  const body = `## Summary

**Tool:** \`${finding.tool}\`
**Rule:** \`${finding.ruleId}\`
**Severity:** ${finding.severity}
**Confidence:** ${finding.confidence}
**Effort:** ${finding.effort}
**Layer:** ${finding.layer}

${finding.message}

## Location

${locationStr}
${finding.locations.length > 1 ? `\n*Plus ${finding.locations.length - 1} additional location(s)*` : ""}
${evidenceSection}
${fixSection}

## Agent Instructions

This issue is designed to be resolved by an AI coding agent (e.g., ${agentHint}).

1. Create a branch: \`${branchPrefix}${shortFingerprint(finding.fingerprint)}/${finding.ruleId.replace(/[^a-z0-9]/gi, "-").toLowerCase()}\`
2. Implement the suggested fix
3. Run \`trunk check\` and \`pnpm test\` to verify
4. Open a PR referencing this issue: "Fixes #ISSUE_NUMBER"

## Metadata

- **Fingerprint:** \`${shortFingerprint(finding.fingerprint)}\`
- **Commit:** \`${repo.commit.substring(0, 7)}\`
- **Run:** #${runNumber}
- **Generated:** ${timestamp}

---

${generateFingerprintMarker(finding.fingerprint)}
${generateRunMetadataMarker(runNumber, timestamp)}
`;

  return body;
}

/**
 * Generate the issue title for a finding.
 */
function generateIssueTitle(finding: Finding): string {
  const location = finding.locations[0];
  const locationHint = location ? ` in ${location.path.split("/").pop()}` : "";
  const maxLen = 100;

  let title = `[vibeCop] ${finding.title}${locationHint}`;
  if (title.length > maxLen) {
    title = title.substring(0, maxLen - 3) + "...";
  }

  return title;
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

  // Build a secondary lookup by tool|ruleId for fallback matching
  const toolRuleMap = new Map<string, ExistingIssue>();
  for (const issue of existingIssues) {
    // Extract tool and rule from issue title like "[vibeCop] knip: files in ..."
    const titleMatch = issue.title.match(/\[vibeCop\]\s+(\w+):\s+(\S+)/i);
    if (titleMatch) {
      const key = `${titleMatch[1].toLowerCase()}|${titleMatch[2].toLowerCase()}`;
      // Only keep the first (oldest) match to update
      if (!toolRuleMap.has(key)) {
        toolRuleMap.set(key, issue);
      }
    }
  }

  // Process each finding
  for (const finding of actionableFindings) {
    seenFingerprints.add(finding.fingerprint);

    // Try fingerprint match first, then fallback to tool|rule match
    let existingIssue = fingerprintMap.get(finding.fingerprint);
    const toolRuleKey = `${finding.tool.toLowerCase()}|${finding.ruleId.toLowerCase()}`;

    if (!existingIssue) {
      // Fallback: check if there's an existing issue for same tool+rule
      existingIssue = toolRuleMap.get(toolRuleKey);
      if (existingIssue) {
        console.log(
          `Found existing issue #${existingIssue.number} by tool+rule match`,
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
  }

  return stats;
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
