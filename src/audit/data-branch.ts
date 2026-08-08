/**
 * Data-branch state fold (round 6)
 *
 * The data PR is never merged (maintainer policy: it exists to carry
 * instructions), so machine state committed to `vibecompact/data` never
 * reaches the default branch. Without this module, every run and every
 * gate evaluation folds only main's ledger — firing history, hysteresis,
 * `improving`, and the fix-confirmation gate path all starve.
 *
 * The fix mirrors the ledger's own design: read the branch copy, union
 * with the local copy, and let ULID dedup + (at, id) ordering produce
 * one deterministic fold. Best-effort — no branch, no fetch, no problem.
 */

import { execFileSync } from "node:child_process";
import { AUDIT_DATA_BRANCH } from "./publish/github.js";
import { LEDGER_PATH, type LedgerEvent } from "./ledger.js";
import { TRENDS_PATH, type TrendEntry } from "./trends.js";

function git(rootPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function showFromDataBranch(rootPath: string, path: string): string | null {
  for (const ref of [`origin/${AUDIT_DATA_BRANCH}`, AUDIT_DATA_BRANCH]) {
    try {
      return git(rootPath, ["show", `${ref}:${path}`]);
    } catch {
      // ref or file absent — try the next form.
    }
  }
  return null;
}

/** Fetch the data branch ref if a remote exists; quiet no-op otherwise. */
export function fetchDataBranch(rootPath: string): void {
  try {
    git(rootPath, ["fetch", "--quiet", "origin", AUDIT_DATA_BRANCH]);
  } catch {
    // No remote, offline, or branch not created yet.
  }
}

/** Ledger events committed to the data branch (empty when absent). */
export function readDataBranchLedger(rootPath: string): LedgerEvent[] {
  const raw = showFromDataBranch(rootPath, LEDGER_PATH);
  if (!raw) return [];
  const events: LedgerEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LedgerEvent;
      if (parsed.id && parsed.at) events.push(parsed);
    } catch {
      // Skip garbage — same tolerance as the local reader.
    }
  }
  return events;
}

/** Trend entries from the data branch, merged with local by (sha, dirty). */
export function mergeDataBranchTrends(
  rootPath: string,
  local: TrendEntry[],
): TrendEntry[] {
  const raw = showFromDataBranch(rootPath, TRENDS_PATH);
  if (!raw) return local;
  let branch: TrendEntry[];
  try {
    branch = JSON.parse(raw) as TrendEntry[];
    if (!Array.isArray(branch)) return local;
  } catch {
    return local;
  }
  const seen = new Set(local.map((e) => `${e.sha} ${e.dirty}`));
  const merged = [
    ...local,
    ...branch.filter((e) => !seen.has(`${e.sha} ${e.dirty}`)),
  ];
  merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return merged;
}
