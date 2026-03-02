/**
 * Findings to ADO Work Items Converter
 *
 * Creates and updates ADO work items from vibecheck findings.
 * Parallel to src/github/sarif-to-issues.ts but targets Azure DevOps.
 */

import { deduplicateFindings } from "../utils/fingerprints.js";
import {
  buildFingerprintMap,
  closeWorkItem,
  createWorkItem,
  getAdoConfig,
  queryWorkItemsByTag,
  updateWorkItem,
  withRateLimit,
  type AdoWorkItem,
} from "./ado-api.js";
import {
  generateWorkItemTitle,
  generateWorkItemDescription,
  getTagsForFinding,
} from "../output/workitem-formatter.js";
import { detectLanguagesInFindings } from "../output/issue-formatter.js";
import { compareFindingsForSort, meetsThresholds } from "../scoring/index.js";
import { DEFAULT_CONFIG, type Finding, type RunContext } from "../core/types.js";

// ============================================================================
// Work Item Orchestration
// ============================================================================

export interface WorkItemStats {
  created: number;
  updated: number;
  closed: number;
  skippedBelowThreshold: number;
  skippedDuplicate: number;
  skippedMaxReached: number;
}

/**
 * Process findings and create/update/close ADO work items.
 */
export async function processFindings(
  findings: Finding[],
  context: RunContext,
): Promise<WorkItemStats> {
  const stats: WorkItemStats = {
    created: 0,
    updated: 0,
    closed: 0,
    skippedBelowThreshold: 0,
    skippedDuplicate: 0,
    skippedMaxReached: 0,
  };

  const config = getAdoConfig();
  if (!config) {
    console.error("ADO_ORG, ADO_PROJECT, and ADO_PAT environment variables are required");
    return stats;
  }

  const defaultIssues = DEFAULT_CONFIG.issues!;
  const issuesConfig = {
    enabled: context.config.issues?.enabled ?? defaultIssues.enabled,
    label: context.config.issues?.label ?? defaultIssues.label,
    max_new_per_run: context.config.issues?.max_new_per_run ?? defaultIssues.max_new_per_run,
    severity_threshold: context.config.issues?.severity_threshold ?? defaultIssues.severity_threshold,
    confidence_threshold: context.config.issues?.confidence_threshold ?? defaultIssues.confidence_threshold,
    close_resolved: context.config.issues?.close_resolved ?? defaultIssues.close_resolved,
    assignees: context.config.issues?.assignees ?? defaultIssues.assignees,
  };

  console.log(
    `Work item thresholds: severity>=${issuesConfig.severity_threshold}, confidence>=${issuesConfig.confidence_threshold}`,
  );

  if (!issuesConfig.enabled) {
    console.log("Work item creation is disabled");
    return stats;
  }

  // Fetch existing vibeCheck work items
  console.log("Fetching existing vibeCheck work items...");
  const existingWorkItems = await queryWorkItemsByTag(config, issuesConfig.label);
  const fingerprintMap = buildFingerprintMap(existingWorkItems);
  console.log(`Found ${existingWorkItems.length} existing work items`);

  // Deduplicate findings
  const uniqueFindings = deduplicateFindings(findings);
  console.log(`Processing ${uniqueFindings.length} unique findings`);

  // Filter by threshold
  const filteredFindings = uniqueFindings.filter((finding) =>
    meetsThresholds(
      finding.severity,
      finding.confidence,
      issuesConfig.severity_threshold,
      issuesConfig.confidence_threshold,
    ),
  );

  stats.skippedBelowThreshold = uniqueFindings.length - filteredFindings.length;
  console.log(`${filteredFindings.length} findings meet thresholds`);

  // Sort by severity desc
  const actionableFindings = [...filteredFindings].sort(compareFindingsForSort);

  // Detect languages
  const languagesInRun = detectLanguagesInFindings(actionableFindings);

  // Track seen fingerprints
  const seenFingerprints = new Set<string>();

  // Build title lookup for existing work items
  const titleMap = new Map<string, AdoWorkItem>();
  for (const wi of existingWorkItems) {
    titleMap.set(normalizeTitle(wi.title), wi);
  }

  // Process each finding
  for (const finding of actionableFindings) {
    seenFingerprints.add(finding.fingerprint);

    // Match by fingerprint first, then by title
    let existingWI = fingerprintMap.get(finding.fingerprint);
    let matchedBy = existingWI ? "fingerprint" : "none";

    if (!existingWI) {
      const newTitle = generateWorkItemTitle(finding);
      const normalized = normalizeTitle(newTitle);
      const titleMatch = titleMap.get(normalized);
      if (titleMatch) {
        existingWI = titleMatch;
        matchedBy = "title";
      }
    }

    console.log(
      `  Finding: ${finding.ruleId} (${finding.tool}) - matched by: ${matchedBy}${existingWI ? ` -> #${existingWI.id}` : ""}`,
    );

    if (existingWI) {
      // Mark fingerprint as seen
      if (existingWI.metadata?.fingerprint) {
        seenFingerprints.add(existingWI.metadata.fingerprint);
      }

      const title = generateWorkItemTitle(finding);
      const description = generateWorkItemDescription(finding, context);
      const tags = getTagsForFinding(finding, issuesConfig.label, languagesInRun);

      // Check if update is needed
      if (existingWI.title === title && tagsMatch(existingWI.tags, tags)) {
        console.log(`Skipping work item #${existingWI.id} (no changes)`);
      } else {
        console.log(`Updating work item #${existingWI.id} for ${finding.ruleId}`);
        await withRateLimit(() =>
          updateWorkItem(config, {
            id: existingWI!.id,
            title,
            description,
            tags,
          }),
        );
        stats.updated++;
      }
    } else {
      // Create new work item
      if (stats.created >= issuesConfig.max_new_per_run) {
        stats.skippedMaxReached++;
        continue;
      }

      const title = generateWorkItemTitle(finding);
      const description = generateWorkItemDescription(finding, context);
      const tags = getTagsForFinding(finding, issuesConfig.label, languagesInRun);

      const workItemId = await withRateLimit(() =>
        createWorkItem(config, {
          title,
          description,
          tags,
          severity: finding.severity,
          assignedTo: issuesConfig.assignees?.[0],
        }),
      );

      console.log(`Created work item #${workItemId}`);
      stats.created++;

      // Register in maps
      const newWI: AdoWorkItem = {
        id: workItemId,
        title,
        description,
        state: "New",
        tags,
        url: "",
        metadata: { fingerprint: finding.fingerprint, lastSeenRun: context.runNumber },
      };
      fingerprintMap.set(finding.fingerprint, newWI);
      titleMap.set(normalizeTitle(title), newWI);
    }
  }

  // Close resolved work items
  if (issuesConfig.close_resolved) {
    for (const wi of existingWorkItems) {
      if (wi.state === "Resolved" || wi.state === "Closed") continue;
      if (!wi.metadata?.fingerprint) continue;
      if (seenFingerprints.has(wi.metadata.fingerprint)) continue;

      console.log(`Closing work item #${wi.id} (finding no longer detected)`);
      await withRateLimit(() =>
        closeWorkItem(
          config,
          wi.id,
          "This issue appears to be resolved. The finding was not detected in the latest vibeCheck analysis.",
        ),
      );
      stats.closed++;
    }
  }

  return stats;
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[vibecheck\]\s*/i, "")
    .replace(/\s*\(\d+\s*occurrences?\)/gi, "")
    .replace(/\s+in\s+\S+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagsMatch(a: string[], b: string[]): boolean {
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.length === sortedB.length && sortedA.every((v, i) => v === sortedB[i]);
}
