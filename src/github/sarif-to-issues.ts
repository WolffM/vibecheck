/**
 * SARIF to Issues Converter
 *
 * Creates and updates GitHub issues from findings with deduplication
 * and rate limiting.
 *
 * Reference: vibeCheck_spec.md section 8
 */

import { extractSublinter } from "../utils/fingerprints.js";
import { prepareAndLogFindingsForProcessing } from "../utils/finding-processing.js";
import { addToMapArray, arraysEqual } from "../utils/shared.js";
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
} from "../output/issue-formatter.js";
import {
  resolveIssuesConfig,
  type ExistingIssue,
  type Finding,
  type RunContext,
} from "../core/types.js";

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
  const issuesConfig = resolveIssuesConfig(context.config);

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

  // Fetch open issues only - we never reopen closed issues
  // If a finding was previously closed and reappears, we create a new issue
  const allExistingIssues: ExistingIssue[] = [];
  for (const label of labelsToSearch) {
    const openIssues = await searchIssuesByLabel(owner, repo, [label], "open");
    allExistingIssues.push(...openIssues);
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

  const { actionableFindings, skippedBelowThreshold } =
    prepareAndLogFindingsForProcessing(
      findings,
      issuesConfig.severity_threshold,
      issuesConfig.confidence_threshold,
    );

  stats.skippedBelowThreshold = skippedBelowThreshold;

  // Detect which languages have findings (for conditional lang: labels)
  const languagesInRun = detectLanguagesInFindings(actionableFindings);
  if (languagesInRun.size > 1) {
    console.log(
      `Multiple languages detected: ${[...languagesInRun].join(", ")} - adding lang: labels`,
    );
  }

  // Track which fingerprints we've seen in this run
  const seenFingerprints = new Set<string>();

  // Build lookup maps from open issues for deduplication
  const toolRuleMap = new Map<string, ExistingIssue[]>(); // tool|ruleId -> issues
  const ruleOnlyMap = new Map<string, ExistingIssue[]>(); // ruleId only -> issues (for cross-tool matching)
  const normalizedTitleMap = new Map<string, ExistingIssue[]>(); // normalized title -> issues

  // Helper to get best issue from map (prefers open, then highest number)
  function getBestIssue(map: Map<string, ExistingIssue[]>, key: string): ExistingIssue | undefined {
    const issues = map.get(key);
    if (!issues || issues.length === 0) return undefined;

    // Sort: open issues first, then by number descending (newest first)
    const sorted = [...issues].sort((a, b) => {
      if (a.state === "open" && b.state !== "open") return -1;
      if (a.state !== "open" && b.state === "open") return 1;
      return b.number - a.number;
    });
    return sorted[0];
  }

  // Build maps from ALL existing issues
  for (const issue of existingIssues) {
    // Add to normalized title map
    const normalizedTitle = normalizeIssueTitle(issue.title);
    addToMapArray(normalizedTitleMap, normalizedTitle, issue);

    // Extract tool and rule from issue title
    const titleMatch = issue.title.match(
      /\[vibeCheck\]\s+(\w+)(?::\s+(\S+)|[\s(])/i,
    );
    if (titleMatch) {
      const toolOrSublinter = titleMatch[1].toLowerCase();
      const ruleId = titleMatch[2]?.toLowerCase();

      if (ruleId) {
        const key = `${toolOrSublinter}|${ruleId}`;
        addToMapArray(toolRuleMap, key, issue);
        // Also add to rule-only map for cross-tool matching (trunk vs standalone)
        addToMapArray(ruleOnlyMap, ruleId, issue);
      }
    }
  }

  // Unified function to find matching issue using all strategies
  function findMatchingIssue(finding: Finding): { issue: ExistingIssue | undefined; matchedBy: string } {
    // Strategy 1: Fingerprint (most reliable)
    const fpMatch = fingerprintMap.get(finding.fingerprint);
    if (fpMatch) return { issue: fpMatch, matchedBy: "fingerprint" };

    // Strategy 2: Tool + Rule (exact match)
    const toolRuleKey = `${finding.tool.toLowerCase()}|${finding.ruleId.toLowerCase()}`;
    const toolRuleMatch = getBestIssue(toolRuleMap, toolRuleKey);
    if (toolRuleMatch) return { issue: toolRuleMatch, matchedBy: `tool+rule(${toolRuleKey})` };

    // Strategy 3: Merged rule matching
    // If this finding has a merged ruleId (e.g., "TS2578+TS2322"), check if any
    // existing issue matches one of the individual rules
    if (finding.ruleId.includes("+")) {
      const individualRules = finding.ruleId.toLowerCase().split("+");
      for (const rule of individualRules) {
        const key = `${finding.tool.toLowerCase()}|${rule}`;
        const match = getBestIssue(toolRuleMap, key);
        if (match) return { issue: match, matchedBy: `merged-rule(${rule})` };
      }
    }

    // Strategy 4: Rule only (catches trunk vs standalone tool mismatches)
    // Only use this for rule IDs that are clearly unique (e.g., B105 for bandit, MD001 for markdownlint)
    // Skip generic rule IDs that could appear in multiple tools
    const ruleOnlyKey = finding.ruleId.toLowerCase();
    const isDistinctiveRuleId = /^[a-z]+\d+$/.test(ruleOnlyKey) || // e.g., b105, md001, e501
                                ruleOnlyKey.includes("/") ||        // e.g., @typescript-eslint/no-unused-vars
                                ruleOnlyKey.includes("-");          // e.g., no-unused-vars, quoted-strings
    if (isDistinctiveRuleId) {
      const ruleOnlyMatch = getBestIssue(ruleOnlyMap, ruleOnlyKey);
      if (ruleOnlyMatch) return { issue: ruleOnlyMatch, matchedBy: `rule-only(${ruleOnlyKey})` };
    }

    // Strategy 5: Normalized title (for legacy issues without fingerprints)
    const newTitle = generateIssueTitle(finding);
    const normalizedNewTitle = normalizeIssueTitle(newTitle);
    const titleMatch = getBestIssue(normalizedTitleMap, normalizedNewTitle);
    if (titleMatch) return { issue: titleMatch, matchedBy: `title(${normalizedNewTitle})` };

    // Strategy 6: Sublinter matching (for trunk)
    // If finding is from trunk, try to match by sublinter (markdownlint, yamllint, etc.)
    if (finding.tool.toLowerCase() === "trunk") {
      const sublinter = extractSublinter(finding);
      for (const key of toolRuleMap.keys()) {
        // Check if any existing issue is for the same sublinter
        if (key.startsWith(`${sublinter}|`) || key.includes(`|${sublinter}`)) {
          const match = getBestIssue(toolRuleMap, key);
          if (match) return { issue: match, matchedBy: `sublinter(${sublinter})` };
        }
      }
    }

    return { issue: undefined, matchedBy: "none" };
  }

  // Helper to register an issue in all lookup maps
  function registerIssueInMaps(issue: ExistingIssue, finding: Finding) {
    // Add to fingerprint map
    fingerprintMap.set(finding.fingerprint, issue);

    // Add to tool+rule map
    const toolRuleKey = `${finding.tool.toLowerCase()}|${finding.ruleId.toLowerCase()}`;
    addToMapArray(toolRuleMap, toolRuleKey, issue);

    // Add to rule-only map
    addToMapArray(ruleOnlyMap, finding.ruleId.toLowerCase(), issue);

    // Add to normalized title map
    const normalizedTitle = normalizeIssueTitle(issue.title);
    addToMapArray(normalizedTitleMap, normalizedTitle, issue);
  }

  // Process each finding
  for (const finding of actionableFindings) {
    seenFingerprints.add(finding.fingerprint);

    // Use unified matching to find existing issue (checks ALL strategies)
    const { issue: existingIssue, matchedBy } = findMatchingIssue(finding);

    console.log(`  Finding: ${finding.ruleId} (${finding.tool}) - matched by: ${matchedBy}${existingIssue ? ` -> #${existingIssue.number}` : ""}`);

    if (existingIssue) {
      // Mark the issue's fingerprint as seen
      if (existingIssue.metadata?.fingerprint) {
        seenFingerprints.add(existingIssue.metadata.fingerprint);
      }

      const title = generateIssueTitle(finding);
      const body = generateIssueBody(finding, context);
      const labels = getLabelsForFinding(finding, issuesConfig.label, languagesInRun);

      // Skip update if content hasn't changed (avoid unnecessary API calls)
      const labelsMatch = arraysEqual(
        (existingIssue.labels || []).sort(),
        labels.sort(),
      );
      if (existingIssue.title === title && existingIssue.body === body && labelsMatch) {
        console.log(`Skipping issue #${existingIssue.number} (no changes)`);
      } else {
        console.log(`Updating issue #${existingIssue.number} for ${finding.ruleId}`);

        await withRateLimit(() =>
          updateIssue(owner, repo, {
            number: existingIssue.number,
            title,
            body,
            labels,
          }),
        );

        stats.updated++;
      }
    } else {
      // No existing issue found - create new one (respect max cap)
      if (stats.created >= issuesConfig.max_new_per_run) {
        stats.skippedMaxReached++;
        continue;
      }

      const title = generateIssueTitle(finding);
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

      // Register new issue in all lookup maps so subsequent findings won't create duplicates
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
      registerIssueInMaps(newIssue, finding);
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
  }

  // Always close pre-existing duplicate issues (from before the dedup fix)
  // This runs regardless of close_resolved setting to clean up legacy duplicates
  await closePreExistingDuplicates(
    owner,
    repo,
    existingIssues,
    normalizedTitleMap,
    stats,
  );

  return stats;
}

/**
 * Check if an existing issue is superseded by a merged finding.
 *
 * This handles merge strategy changes where:
 * - Old issues were created with a finer-grained strategy (e.g., same-rule)
 * - New run uses a coarser strategy (e.g., same-linter or same-tool)
 * - Result: multiple old issues should be closed in favor of one merged issue
 *
 * Also handles:
 * - Trunk issues being superseded by merged sublinter findings
 * - Standalone tool issues being superseded by merged findings
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

  // Extract tool and rule from the issue title
  const titleMatch = issue.title.match(
    /\[vibeCheck\]\s+(\w+)(?::\s+(\S+))?/i
  );
  if (!titleMatch) {
    return { superseded: false };
  }

  const issueToolOrSublinter = titleMatch[1].toLowerCase();
  const issueRuleId = titleMatch[2]?.toLowerCase();

  // Check if this looks like a single-rule issue (has a specific rule ID)
  const isSingleRuleIssue = !!issueRuleId && !issueRuleId.includes("+");
  if (!isSingleRuleIssue) {
    return { superseded: false };
  }

  // Look for a merged finding that contains this issue's rule
  for (const finding of findings) {
    const findingTool = finding.tool.toLowerCase();
    
    // Check if tools match (or sublinter matches for trunk)
    const findingSublinter = extractSublinter(finding);
    const toolMatches = 
      findingTool === issueToolOrSublinter || 
      findingSublinter === issueToolOrSublinter;
    
    if (!toolMatches) continue;

    // Check if this finding is a merged one (has multiple rules)
    const isMergedFinding =
      finding.ruleId.includes("+") ||
      finding.title.includes("issues across") ||
      finding.title.includes("occurrences)");

    if (!isMergedFinding) continue;

    // Check if the merged finding contains this issue's rule
    const mergedRules = finding.ruleId.toLowerCase().split("+");
    if (mergedRules.includes(issueRuleId)) {
      return { superseded: true, supersededBy: finding };
    }

    // For same-linter/same-tool strategy, any merged finding for the same tool supersedes
    // single-rule issues even if the specific rule isn't in the merged ruleId
    // (because the merged finding represents ALL rules from that tool/linter)
    if (isMergedFinding && toolMatches) {
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
 * Close pre-existing duplicate issues.
 *
 * When multiple open issues exist with the same normalized title, keep only
 * the newest one (highest issue number) and close the others as duplicates.
 *
 * This handles legacy duplicates that were created before the dedup fix was
 * implemented. New duplicates are prevented by findMatchingIssue().
 */
async function closePreExistingDuplicates(
  owner: string,
  repo: string,
  existingIssues: ExistingIssue[],
  normalizedTitleMap: Map<string, ExistingIssue[]>,
  stats: IssueStats,
): Promise<void> {
  // Track which issues we've already decided to close
  const issuesToClose = new Set<number>();

  // For each normalized title, find duplicates (all issues are open since we only fetch open)
  for (const [normalizedTitle, issues] of normalizedTitleMap.entries()) {
    if (issues.length <= 1) continue; // No duplicates

    // Sort by issue number descending (newest first)
    const sorted = [...issues].sort((a, b) => b.number - a.number);

    // Keep the newest, mark the rest for closing
    const [keeper, ...duplicates] = sorted;

    console.log(
      `Found ${duplicates.length} duplicate(s) for "${normalizedTitle}" - keeping #${keeper.number}`,
    );

    for (const dup of duplicates) {
      issuesToClose.add(dup.number);
    }
  }

  // Close the duplicates
  for (const issue of existingIssues) {
    if (!issuesToClose.has(issue.number)) continue;

    console.log(`Closing duplicate issue #${issue.number} ("${issue.title}")`);

    await withRateLimit(() =>
      closeIssue(
        owner,
        repo,
        issue.number,
        `🔄 This is a duplicate issue. The findings are now tracked in a newer issue.\n\nClosed automatically by vibeCheck.`,
      ),
    );

    issue.state = "closed";
    stats.closed++;
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

  // Load findings and context using shared utility
  const { loadFindingsAndContext } = await import("../utils/cli-utils.js");
  const { findings, context } = loadFindingsAndContext(findingsPath, contextPath);
  console.log(`Loaded ${findings.length} findings`);

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
