/**
 * L3 · Arrival forensics lane (outcome-predictive, in-house)
 *
 * Signals per design §3.1-L3:
 *  - test co-change (primary): share of a file's commits that co-touched
 *    no test reaching it. Graph-joined for TS/JS via the import graph;
 *    other languages fall back to commit granularity with demoted
 *    confidence.
 *  - bulk arrival (secondary): largest single-commit addition normalized
 *    against the repo's own commit-shape baseline; auto-mutes when squash
 *    uniformity collapses the baseline's variance.
 *  - snapshot churn: snapshot/golden edits in commits touching no test
 *    logic, attributed to the co-touched source files.
 *
 * Behavioral constants (§10.1 taxonomy) are declared inline and revisited
 * with M1 field data.
 */

import type { GitHistory } from "../git-arrival.js";
import { buildFileHistories, isTestFile } from "../git-arrival.js";
import {
  buildImportGraph,
  isTsJsFile,
  reachableFrom,
} from "../import-graph.js";

/** Files touched fewer times than this leave the lane not-applicable. */
export const ARRIVAL_MIN_TOUCHES = 3;
/** History window before the anchor date; older commits are ignored. */
export const ARRIVAL_WINDOW_DAYS = 365;
/** Bulk arrival mutes when squash-dominant and commit sizes this uniform. */
const BULK_MUTE_MAX_CV = 0.6;
/** Hand-set secondary-signal weights folded into the lane density. */
const BULK_WEIGHT = 0.15;
const BULK_SATURATION = 10;
const SNAPSHOT_WEIGHT = 0.15;

const SNAPSHOT_PATTERNS: RegExp[] = [
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /(^|\/)testdata\//,
  /(^|\/)golden\//,
];

export function isSnapshotFile(path: string): boolean {
  const posix = path.replace(/\\/g, "/");
  return SNAPSHOT_PATTERNS.some((re) => re.test(posix));
}

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "java", "kt", "kts", "cs", "rb", "php",
  "c", "h", "cpp", "hpp", "cc", "hh", "swift", "scala", "ex", "exs",
]);

function isCodeFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Language family for the no-test-infrastructure abstention. "no test
 * reaches this file" only discriminates when tests for the file's
 * language exist at all; a subtree with no test runner is a repo-level
 * fact, not N per-file findings (pygmalion beta finding 5).
 */
export function arrivalLanguageFamily(path: string): string {
  if (isTsJsFile(path)) return "TS/JS";
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "py") return "Python";
  return ext;
}

export interface ArrivalLaneEntry {
  path: string;
  /** Non-merge commits touching the file inside the window. */
  touches: number;
  /** Lane applicability: below ARRIVAL_MIN_TOUCHES the lane abstains. */
  applicable: boolean;
  /** Share of touches with no reaching (or any, in commit mode) test. */
  untestedShare: number;
  /** graph = import-graph join (TS/JS); commit = any-test fallback. */
  coChangeMode: "graph" | "commit";
  /** Largest single-commit addition ÷ repo median commit size; 0 if muted. */
  bulkScore: number;
  snapshotChurnShare: number;
  /** Lane density consumed by scoring anchors. */
  score: number;
}

export interface ArrivalLaneResult {
  lane: "arrival";
  available: boolean;
  disclosures: string[];
  bulkMuted: boolean;
  entries: ArrivalLaneEntry[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/** Pure core — testable without touching the filesystem for the graph. */
export function buildArrivalLane(
  history: GitHistory,
  candidateFiles: string[],
  testReach: Map<string, Set<string>>,
): ArrivalLaneResult {
  const disclosures: string[] = [];
  const windowStart =
    Date.parse(history.anchorDate) - ARRIVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const commits = history.commits.filter(
    (c) => !c.isMerge && Date.parse(c.date) >= windowStart,
  );
  const commitsBySha = new Map(commits.map((c) => [c.sha, c]));

  // Repo commit-shape baseline for bulk arrival.
  const commitSizes = commits
    .map((c) => c.files.reduce((sum, f) => sum + f.added, 0))
    .filter((size) => size > 0);
  const baseline = median(commitSizes);
  const cv = coefficientOfVariation(commitSizes);
  const bulkMuted =
    history.workflowShape.squashDominant && cv < BULK_MUTE_MAX_CV;
  if (bulkMuted) {
    disclosures.push(
      `bulk arrival muted: squash-dominant history with uniform commit sizes (cv=${cv.toFixed(2)}) collapses the baseline`,
    );
  }
  if (history.shallow) {
    disclosures.push(
      "shallow clone: history truncated, arrival signals read less far back",
    );
  }

  const perFile = buildFileHistories(commits);
  const candidates = new Set(candidateFiles);

  // Language families that have any test file at all in the current
  // tree. A family with none cannot be discriminated by test co-change:
  // its files abstain, and the fact is disclosed once at repo level.
  const testedFamilies = new Set(
    candidateFiles.filter(isTestFile).map(arrivalLanguageFamily),
  );
  const untestableByFamily = new Map<string, number>();

  const entries: ArrivalLaneEntry[] = [];
  let graphCount = 0;
  let commitCount = 0;

  for (const [path, fileCommits] of perFile) {
    if (!candidates.has(path)) continue;
    if (!isCodeFile(path) || isTestFile(path) || isSnapshotFile(path)) continue;

    const family = arrivalLanguageFamily(path);
    const familyHasTests = testedFamilies.has(family);
    if (!familyHasTests) {
      untestableByFamily.set(family, (untestableByFamily.get(family) ?? 0) + 1);
    }

    const touches = fileCommits.length;
    const applicable = familyHasTests && touches >= ARRIVAL_MIN_TOUCHES;
    const graphMode = isTsJsFile(path) && testReach.size > 0;
    if (graphMode) graphCount++;
    else commitCount++;

    let untested = 0;
    let snapshotChurn = 0;
    let maxAdded = 0;
    for (const entry of fileCommits) {
      const commit = commitsBySha.get(entry.sha);
      if (!commit) continue;
      const covered = graphMode
        ? commit.testFiles.some((t) => testReach.get(t)?.has(path))
        : commit.testFiles.length > 0;
      if (!covered) untested++;

      const realTestLogic = commit.testFiles.some((t) => !isSnapshotFile(t));
      const snapshotsEdited = commit.files.some((f) => isSnapshotFile(f.path));
      if (snapshotsEdited && !realTestLogic) snapshotChurn++;

      if (entry.added > maxAdded) maxAdded = entry.added;
    }

    const untestedShare = touches === 0 ? 0 : untested / touches;
    const snapshotChurnShare = touches === 0 ? 0 : snapshotChurn / touches;
    const bulkScore = bulkMuted || baseline === 0 ? 0 : maxAdded / baseline;

    const score = applicable
      ? untestedShare +
        BULK_WEIGHT * Math.min(1, bulkScore / BULK_SATURATION) +
        SNAPSHOT_WEIGHT * snapshotChurnShare
      : 0;

    entries.push({
      path,
      touches,
      applicable,
      untestedShare,
      coChangeMode: graphMode ? "graph" : "commit",
      bulkScore,
      snapshotChurnShare,
      score,
    });
  }

  for (const [family, count] of [...untestableByFamily.entries()].sort()) {
    disclosures.push(
      `${family}: no test files exist anywhere in the repo — arrival abstains for ${count} ${family} file${count === 1 ? "" : "s"} (repo-level fact: that subtree has no test infrastructure, not a per-file finding)`,
    );
  }
  if (commitCount > 0) {
    disclosures.push(
      `test co-change: ${graphCount} files graph-joined, ${commitCount} on commit granularity (demoted confidence)`,
    );
  }
  if (history.age.youngRepo) {
    disclosures.push(
      "young repo: current import graph is near-exact for this history",
    );
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { lane: "arrival", available: true, disclosures, bulkMuted, entries };
}

/** Reachability of candidate files from each current test file. */
export function buildTestReachability(
  importGraph: Map<string, string[]>,
): Map<string, Set<string>> {
  const reach = new Map<string, Set<string>>();
  for (const file of importGraph.keys()) {
    if (isTestFile(file)) reach.set(file, reachableFrom(importGraph, file));
  }
  return reach;
}

export function runArrivalLane(
  rootPath: string,
  history: GitHistory | null,
  candidateFiles: string[],
  importGraph?: Map<string, string[]>,
): ArrivalLaneResult {
  if (!history) {
    return {
      lane: "arrival",
      available: false,
      disclosures: [
        "no git history available — arrival lane skipped (not a git repository or no commits)",
      ],
      bulkMuted: false,
      entries: [],
    };
  }
  const graph = importGraph ?? buildImportGraph(rootPath, candidateFiles);
  return buildArrivalLane(history, candidateFiles, buildTestReachability(graph));
}
