/**
 * SARIF to Issues Converter
 *
 * Creates and updates GitHub issues from findings with deduplication
 * and rate limiting.
 *
 * Reference: vibeCheck_spec.md section 8
 */

import { readFileSync, existsSync } from "node:fs";
import { deduplicateFindings } from "./fingerprints.js";
import {
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
import {
  detectLanguagesInFindings,
  generateIssueBody,
  generateIssueTitle,
  getLabelsForFinding,
} from "./issue-formatter.js";
import { meetsThresholds } from "./scoring.js";
import type { ExistingIssue, Finding, RunContext } from "./types.js";

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
    label: "vibeCheck",
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

  // Fetch existing issues (include legacy vibeCop label for backwards compatibility)
  console.log("Fetching existing vibeCheck issues...");
  const labelsToSearch = [issuesConfig.label];
  // Add legacy label if current label is vibeCheck (to find old vibeCop issues)
  if (issuesConfig.label === "vibeCheck") {
    labelsToSearch.push("vibeCop");
  }

  // Fetch issues with each label separately (GitHub API requires exact label match)
  // Include both open AND recently closed issues to prevent duplicate creation
  // when an issue was closed but the same finding is detected again
  const allExistingIssues: ExistingIssue[] = [];
  for (const label of labelsToSearch) {
    // Fetch open issues
    const openIssues = await searchIssuesByLabel(owner, repo, [label], "open");
    allExistingIssues.push(...openIssues);
    // Also fetch closed issues to check for duplicates and potential reopening
    const closedIssues = await searchIssuesByLabel(owner, repo, [label], "closed");
    allExistingIssues.push(...closedIssues);
  }

  // Deduplicate by issue number (in case an issue has both labels)
  const seenNumbers = new Set<number>();
  const existingIssues = allExistingIssues.filter((issue) => {
    if (seenNumbers.has(issue.number)) return false;
    seenNumbers.add(issue.number);
    return true;
  });

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

  // Detect which languages have findings (for conditional lang: labels)
  const languagesInRun = detectLanguagesInFindings(actionableFindings);
  if (languagesInRun.size > 1) {
    console.log(
      `Multiple languages detected: ${[...languagesInRun].join(", ")} - adding lang: labels`,
    );
  }

  // Track which fingerprints we've seen in this run
  const seenFingerprints = new Set<string>();

  // Build secondary lookups for fallback matching
  const toolRuleMap = new Map<string, ExistingIssue>();
  const sublinterMap = new Map<string, ExistingIssue>(); // For trunk sublinters

  // Build normalized title map for finding duplicates
  // Maps normalized title -> array of issues (to handle existing duplicates)
  const normalizedTitleMap = new Map<string, ExistingIssue[]>();

  for (const issue of existingIssues) {
    // Only consider open issues for matching
    if (issue.state !== "open") continue;

    // Add to normalized title map
    const normalizedTitle = normalizeIssueTitle(issue.title);
    const existing = normalizedTitleMap.get(normalizedTitle);
    if (existing) {
      existing.push(issue);
    } else {
      normalizedTitleMap.set(normalizedTitle, [issue]);
    }

    // Extract tool and rule from issue title like "[vibeCheck] knip: files in ..."
    // Also handles "[vibeCheck] yamllint: quoted-strings" and "[vibeCheck] markdownlint (12 issues..."
    const titleMatch = issue.title.match(
      /\[vibeCheck\]\s+(\w+)(?::\s+(\S+)|[\s(])/i,
    );
    if (titleMatch) {
      const toolOrSublinter = titleMatch[1].toLowerCase();
      const ruleId = titleMatch[2]?.toLowerCase();

      if (ruleId) {
        // Standard format: "[vibeCheck] tool: ruleId ..."
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
      const title = generateIssueTitle(finding);
      const body = generateIssueBody(finding, context);
      const labels = getLabelsForFinding(finding, issuesConfig.label, languagesInRun);

      if (existingIssue.state === "open") {
        console.log(
          `Updating issue #${existingIssue.number} for ${finding.ruleId}`,
        );

        await withRateLimit(() =>
          updateIssue(owner, repo, {
            number: existingIssue!.number,
            title,
            body,
            labels,
          }),
        );

        stats.updated++;
      } else {
        // Issue was closed but finding reappeared - reopen it
        console.log(
          `Reopening issue #${existingIssue.number} for ${finding.ruleId} (finding redetected)`,
        );

        await withRateLimit(() =>
          updateIssue(owner, repo, {
            number: existingIssue!.number,
            title,
            body,
            labels,
            state: "open",
          }),
        );

        // Update the issue's state in our tracking so closeDuplicateIssues sees it as open
        existingIssue.state = "open";
        existingIssue.title = title;

        // Add to normalizedTitleMap so duplicate detection works
        const normalizedTitle = normalizeIssueTitle(title);
        const existingForTitle = normalizedTitleMap.get(normalizedTitle);
        if (existingForTitle) {
          existingForTitle.push(existingIssue);
        } else {
          normalizedTitleMap.set(normalizedTitle, [existingIssue]);
        }

        stats.updated++;
      }
    } else {
      // Before creating, check if there's an existing open issue with similar title
      // This catches duplicates that weren't matched by fingerprint (legacy issues)
      const title = generateIssueTitle(finding);
      const normalizedNewTitle = normalizeIssueTitle(title);
      const matchingIssues = normalizedTitleMap.get(normalizedNewTitle);

      if (matchingIssues && matchingIssues.length > 0) {
        // Found existing issue(s) by title - update the newest one (highest issue number)
        const issueToUpdate = matchingIssues.sort((a, b) => b.number - a.number)[0];
        console.log(
          `Found existing issue #${issueToUpdate.number} by title match for ${finding.ruleId}`,
        );

        const body = generateIssueBody(finding, context);
        const labels = getLabelsForFinding(finding, issuesConfig.label, languagesInRun);

        await withRateLimit(() =>
          updateIssue(owner, repo, {
            number: issueToUpdate.number,
            title,
            body,
            labels,
          }),
        );

        stats.updated++;

        // Track fingerprint to avoid creating more duplicates
        fingerprintMap.set(finding.fingerprint, issueToUpdate);
        if (issueToUpdate.metadata?.fingerprint) {
          seenFingerprints.add(issueToUpdate.metadata.fingerprint);
        }
        continue;
      }

      // Create new issue (respect max cap)
      if (stats.created >= issuesConfig.max_new_per_run) {
        stats.skippedMaxReached++;
        continue;
      }

      console.log(`Creating issue for ${finding.ruleId}`);
      const body = generateIssueBody(finding, context);
      const labels = getLabelsForFinding(finding, issuesConfig.label, languagesInRun);

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

      // Add to normalized title map so we don't create more duplicates this run
      const newIssue: ExistingIssue = {
        number: issueNumber,
        title,
        body,
        state: "open",
        labels,
        metadata: {
          fingerprint: finding.fingerprint,
          lastSeenRun: context.runNumber,
          consecutiveMisses: 0,
        },
      };
      const existingForTitle = normalizedTitleMap.get(normalizedNewTitle);
      if (existingForTitle) {
        existingForTitle.push(newIssue);
      } else {
        normalizedTitleMap.set(normalizedNewTitle, [newIssue]);
      }

      // Add to fingerprint map so we don't create duplicates if multiple
      // merged findings share the same fingerprint
      fingerprintMap.set(finding.fingerprint, {
        number: issueNumber,
        title,
        body,
        state: "open",
        labels,
        metadata: {
          fingerprint: finding.fingerprint,
          lastSeenRun: context.runNumber,
          consecutiveMisses: 0,
        },
      });
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
 * e.g., "[vibeCheck] yamllint: quoted-strings" -> "yamllint"
 * e.g., "[vibeCheck] markdownlint (12 issues..." -> "markdownlint"
 */
function extractSublinterFromTitle(title: string): string | null {
  // Match patterns like "[vibeCheck] yamllint: ..." or "[vibeCheck] yamllint (..."
  const match = title.match(/\[vibeCheck\]\s+(\w+)[\s:(\-]/i);
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
  const isSingleRuleIssue = /\[vibeCheck\]\s+\w+:\s+\S+/.test(issue.title);
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
          `🔄 This issue has been superseded by a consolidated issue that groups all related findings together.\n\nThe individual findings are now tracked in a single merged issue for better organization.\n\nClosed automatically by vibeCheck.`,
        ),
      );

      stats.closed++;
    }
  }
}

/**
 * Normalize an issue title for duplicate detection.
 * Removes occurrence counts and normalizes whitespace.
 * e.g., "[vibeCheck] Duplicate Code: 22 lines (126 occurrences)" -> "duplicate code: 22 lines"
 */
function normalizeIssueTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[vibecheck\]\s*/i, "") // Remove [vibeCheck] prefix
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
          `🔄 This is a duplicate issue. The same finding is tracked in #${keepIssue.number}.\n\nClosed automatically by vibeCheck.`,
        ),
      );

      stats.closed++;
    }
  }
}

/**
 * Close issues that are no longer detected.
 * Issues are closed immediately when their finding is not detected.
 */
async function closeResolvedIssues(
  owner: string,
  repo: string,
  existingIssues: ExistingIssue[],
  seenFingerprints: Set<string>,
  _currentRun: number,
  stats: IssueStats,
): Promise<void> {
  for (const issue of existingIssues) {
    if (issue.state !== "open") continue;
    if (!issue.metadata?.fingerprint) continue;

    // Check if this fingerprint was seen in the current run
    if (seenFingerprints.has(issue.metadata.fingerprint)) {
      continue;
    }

    // Finding not detected - close immediately
    console.log(`Closing issue #${issue.number} (finding no longer detected)`);

    await withRateLimit(() =>
      closeIssue(
        owner,
        repo,
        issue.number,
        `This issue appears to be resolved. The finding was not detected in the latest analysis.\n\nClosed automatically by vibeCheck.`,
      ),
    );

    stats.closed++;
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
