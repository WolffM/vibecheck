/**
 * Activity gate (design §7, v0.2 three-path form)
 *
 * Decides whether a scheduled run should audit at all. Three ways to
 * fire, in priority order:
 *
 *  1. fix-confirmation — a commit since the last audit touches a
 *     currently-firing file (from the ledger fold). No threshold: prompt
 *     feedback on fix attempts is the engagement loop, and the condition
 *     self-resolves when the maintainer stops touching flagged files.
 *  2. volume — ≥ GATE_VOLUME_LINES code lines touched since the last
 *     audited SHA (numstat added+deleted, path-convention and
 *     audit.exclude churn ignored). 2000 = the tier-3 boundary: "a
 *     no-justification-file's worth of work landed since I last looked."
 *  3. staleness — ≥ GATE_STALENESS_DAYS since the last audit with any
 *     activity at all; keeps trend entries breathing and resurfaces
 *     aging justifications on low-volume repos.
 *
 * Everything is measured against commit data, never wall clock, except
 * staleness which compares the last audit's anchor date to HEAD's commit
 * date — still repo-derived. Fails open: no trend history, unknown SHA,
 * or a rewritten history all mean "audit now".
 *
 * The gate guards cron only. Explicit invocations (local runs, manual
 * dispatch) justify themselves and never consult it unless asked
 * (`vibecheck audit --gate`).
 */

import { execFileSync } from "node:child_process";
import {
  fetchDataBranch,
  mergeDataBranchTrends,
  readDataBranchLedger,
} from "./data-branch.js";
import { isPathExcludedFast } from "./exclusions.js";
import { foldLedger, pathOf, readLedger } from "./ledger.js";
import { readTrends } from "./trends.js";
import type { ResolvedAuditConfig } from "./config.js";

/** Behavioral constants (§10.1): declared, revisited with field data. */
export const GATE_VOLUME_LINES = 2000;
export const GATE_STALENESS_DAYS = 90;

export type GateReason =
  | "first-audit"
  | "history-unreadable"
  | "fix-confirmation"
  | "volume"
  | "staleness"
  | "quiet";

export interface GateDecision {
  active: boolean;
  reason: GateReason;
  detail: string;
}

function git(rootPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

interface ChangeStats {
  files: Set<string>;
  linesTouched: number;
  commits: number;
}

function collectChanges(
  rootPath: string,
  sinceSha: string,
  configExcludes: string[],
): ChangeStats | null {
  let raw: string;
  try {
    raw = git(rootPath, [
      "log",
      "--no-renames",
      "--numstat",
      "--format=%x1e",
      `${sinceSha}..HEAD`,
    ]);
  } catch {
    return null;
  }
  const files = new Set<string>();
  let linesTouched = 0;
  let commits = 0;
  for (const chunk of raw.split("\x1e")) {
    if (!chunk.trim()) continue;
    commits++;
    for (const line of chunk.split("\n")) {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!match) continue;
      const path = match[3].replace(/\\/g, "/");
      if (path.startsWith(".vibecompact/") || path.startsWith(".vibecheck/")) continue;
      if (isPathExcludedFast(path, configExcludes)) continue;
      files.add(path);
      if (match[1] !== "-") linesTouched += Number(match[1]);
      if (match[2] !== "-") linesTouched += Number(match[2]);
    }
  }
  return { files, linesTouched, commits };
}

export function evaluateGate(
  rootPath: string,
  config: ResolvedAuditConfig,
): GateDecision {
  // Machine state lives on the data branch (the data PR never merges);
  // fold it in or fix-confirmation and staleness starve.
  fetchDataBranch(rootPath);
  const trends = mergeDataBranchTrends(rootPath, readTrends(rootPath));
  const lastClean = [...trends].reverse().find((entry) => !entry.dirty);
  if (!lastClean || lastClean.sha === "no-git") {
    return {
      active: true,
      reason: "first-audit",
      detail: "no prior clean audit recorded in trends",
    };
  }

  const changes = collectChanges(rootPath, lastClean.sha, config.exclude);
  if (changes === null) {
    return {
      active: true,
      reason: "history-unreadable",
      detail: `last audited SHA ${lastClean.sha.slice(0, 12)} is not reachable (rewritten history?) — failing open`,
    };
  }

  // 1. fix-confirmation: changed files ∩ actively-firing files.
  const fold = foldLedger([
    ...readLedger(rootPath),
    ...readDataBranchLedger(rootPath),
  ]);
  const firingPaths = new Set(
    [...fold.firing.values()]
      .filter((state) => !state.fixedAt)
      .map((state) => pathOf(state.fingerprint)),
  );
  const touchedFiring = [...changes.files].filter((f) => firingPaths.has(f));
  if (touchedFiring.length > 0) {
    return {
      active: true,
      reason: "fix-confirmation",
      detail: `${touchedFiring.length} currently-firing file(s) touched since last audit (e.g. ${touchedFiring[0]})`,
    };
  }

  // 2. volume.
  if (changes.linesTouched >= GATE_VOLUME_LINES) {
    return {
      active: true,
      reason: "volume",
      detail: `${changes.linesTouched} code lines touched since last audit (threshold ${GATE_VOLUME_LINES})`,
    };
  }

  // 3. staleness — repo-derived dates only.
  let headDate: string;
  try {
    headDate = git(rootPath, ["log", "-1", "--format=%cI"]).trim();
  } catch {
    headDate = lastClean.at;
  }
  const ageDays =
    (Date.parse(headDate) - Date.parse(lastClean.at)) / (24 * 60 * 60 * 1000);
  if (changes.commits > 0 && ageDays >= GATE_STALENESS_DAYS) {
    return {
      active: true,
      reason: "staleness",
      detail: `${Math.floor(ageDays)} days of activity since last audit (backstop ${GATE_STALENESS_DAYS})`,
    };
  }

  return {
    active: false,
    reason: "quiet",
    detail:
      changes.commits === 0
        ? "no commits since last audit"
        : `${changes.commits} commit(s), ${changes.linesTouched} lines touched — below every threshold`,
  };
}
