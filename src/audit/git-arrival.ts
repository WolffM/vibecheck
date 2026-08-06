/**
 * Git history substrate for the arrival lane (L3)
 *
 * One `git log --no-renames --numstat` parse per audit run. Everything is
 * anchored to the HEAD commit's committer date — never wall-clock — so the
 * same SHA always produces byte-identical output (design §6 determinism).
 * Commit shape only; authorship identity is never read.
 */

import { execFileSync } from "node:child_process";
import { classifyRepoAge, type RepoAgeProfile } from "../core/repo-detect.js";

export interface CommitFileChange {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface CommitRecord {
  sha: string;
  /** Committer date, ISO-8601 with offset as git reports it. */
  date: string;
  isMerge: boolean;
  subject: string;
  files: CommitFileChange[];
  /** Paths in this commit that are test files. */
  testFiles: string[];
}

export interface FileCommitEntry {
  sha: string;
  date: string;
  added: number;
  deleted: number;
}

/**
 * Squash detection: with squash-merge dominant, main has ~no merge commits
 * and most subjects end in the GitHub "(#123)" suffix. Behavioral
 * constants (§10.1): declared here, revisited with field data.
 */
export interface WorkflowShape {
  commitCount: number;
  mergeShare: number;
  prSquashShare: number;
  squashDominant: boolean;
}

const SQUASH_MAX_MERGE_SHARE = 0.05;
const SQUASH_MIN_PR_SHARE = 0.3;

export interface GitHistory {
  anchorSha: string;
  anchorDate: string;
  shallow: boolean;
  commits: CommitRecord[];
  workflowShape: WorkflowShape;
  age: RepoAgeProfile;
}

const TEST_PATH_PATTERNS: RegExp[] = [
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /(^|\/)spec\//,
  /\.(test|spec)\.[^./]+$/,
  /_test\.(go|py|rb|ts|js|tsx|jsx|exs)$/,
  /(^|\/)test_[^/]+\.py$/,
  /(^|\/)conftest\.py$/,
  /(^|\/)[^/]*Tests?\.(java|kt|cs|scala)$/,
];

export function isTestFile(path: string): boolean {
  const posix = path.replace(/\\/g, "/");
  return TEST_PATH_PATTERNS.some((re) => re.test(posix));
}

function git(rootPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 512 * 1024 * 1024,
  });
}

// Record separator \x1e opens each commit; \x1f separates header fields.
const LOG_FORMAT = "%x1e%H%x1f%cI%x1f%P%x1f%s";

function parseNumstatLine(line: string): CommitFileChange | null {
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const [added, deleted] = parts;
  const path = parts.slice(2).join("\t").replace(/\\/g, "/");
  const binary = added === "-" || deleted === "-";
  return {
    path,
    added: binary ? 0 : Number(added),
    deleted: binary ? 0 : Number(deleted),
    binary,
  };
}

export function parseGitLog(raw: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  for (const chunk of raw.split("\x1e")) {
    if (!chunk.trim()) continue;
    const lines = chunk.split("\n");
    const [sha, date, parents, subject = ""] = lines[0].split("\x1f");
    if (!sha || !date) continue;
    const files: CommitFileChange[] = [];
    for (const line of lines.slice(1)) {
      const change = parseNumstatLine(line);
      if (change) files.push(change);
    }
    commits.push({
      sha,
      date,
      isMerge: parents.trim().split(" ").filter(Boolean).length > 1,
      subject,
      files,
      testFiles: files.map((f) => f.path).filter(isTestFile),
    });
  }
  return commits;
}

export function detectWorkflowShape(commits: CommitRecord[]): WorkflowShape {
  const count = commits.length;
  if (count === 0) {
    return {
      commitCount: 0,
      mergeShare: 0,
      prSquashShare: 0,
      squashDominant: false,
    };
  }
  const merges = commits.filter((c) => c.isMerge).length;
  const nonMerge = commits.filter((c) => !c.isMerge);
  const prPattern = nonMerge.filter((c) => /\(#\d+\)\s*$/.test(c.subject));
  const mergeShare = merges / count;
  const prSquashShare =
    nonMerge.length === 0 ? 0 : prPattern.length / nonMerge.length;
  return {
    commitCount: count,
    mergeShare,
    prSquashShare,
    squashDominant:
      mergeShare <= SQUASH_MAX_MERGE_SHARE &&
      prSquashShare >= SQUASH_MIN_PR_SHARE,
  };
}

/**
 * Collect the full first-parent-inclusive history at HEAD. Returns null
 * outside a git repo or on an unborn branch.
 */
export function collectGitHistory(rootPath: string): GitHistory | null {
  let raw: string;
  let shallow = false;
  try {
    raw = git(rootPath, [
      "log",
      "--no-renames",
      "--numstat",
      `--format=${LOG_FORMAT}`,
    ]);
    shallow =
      git(rootPath, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    return null;
  }

  const commits = parseGitLog(raw);
  if (commits.length === 0) return null;

  // git log emits newest first; the anchor is HEAD, the last entry is root.
  const anchor = commits[0];
  const oldest = commits[commits.length - 1];

  return {
    anchorSha: anchor.sha,
    anchorDate: anchor.date,
    shallow,
    commits,
    workflowShape: detectWorkflowShape(commits),
    age: classifyRepoAge(commits.length, oldest.date, anchor.date),
  };
}

/**
 * Per-file commit lists (newest first, inheriting log order). Binary
 * changes are kept — a touch is a touch for co-change purposes.
 */
export function buildFileHistories(
  commits: CommitRecord[],
): Map<string, FileCommitEntry[]> {
  const histories = new Map<string, FileCommitEntry[]>();
  for (const commit of commits) {
    for (const file of commit.files) {
      let list = histories.get(file.path);
      if (!list) {
        list = [];
        histories.set(file.path, list);
      }
      list.push({
        sha: commit.sha,
        date: commit.date,
        added: file.added,
        deleted: file.deleted,
      });
    }
  }
  return histories;
}

/**
 * Deterministic serialization: same SHA in, byte-identical string out.
 * Used by the determinism tests and the backtest harness.
 */
export function serializeHistory(history: GitHistory): string {
  return JSON.stringify(history);
}

/**
 * Rename map (old → new, newest wins) from a dedicated `-M` pass — the
 * numstat substrate itself runs `--no-renames`. Chains (a→b→c) resolve by
 * following the map. Feeds the ledger's rename-migration pass.
 */
export function collectRenames(rootPath: string): Map<string, string> {
  const renames = new Map<string, string>();
  let raw: string;
  try {
    raw = git(rootPath, [
      "log",
      "-M",
      "--diff-filter=R",
      "--name-status",
      "--format=%x1e",
    ]);
  } catch {
    return renames;
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^R\d+\t([^\t]+)\t([^\t]+)$/);
    if (!match) continue;
    const from = match[1].replace(/\\/g, "/");
    const to = match[2].replace(/\\/g, "/");
    // Newest-first log order: keep the newest rename for a given source.
    if (!renames.has(from)) renames.set(from, to);
  }
  return renames;
}
