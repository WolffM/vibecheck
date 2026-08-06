/**
 * Backtest harness (design §10) — dev CLI only, never part of a shipped
 * audit run.
 *
 * Audit the repo as it was at HEAD−N months (detached worktree), label
 * every audited file by what the following N months actually did to it,
 * and compare corrective-event rates of flagged groups against
 * size-matched controls. Jurisdiction: outcome-predictive lanes and
 * ranking only (state lanes are validated by inspection, never fitted on
 * outcomes — the neglect confound).
 *
 * Anti-tautology rule: lanes fire on pre-epoch data only; outcome labels
 * consume post-epoch commits only. The two windows never overlap.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectGitHistory,
  collectRenames,
  type CommitRecord,
} from "./git-arrival.js";
import { runAudit } from "./index.js";

/** Post-epoch touches at/above this count = "heavily patched". */
export const HEAVY_PATCH_TOUCHES = 5;
/** Post-epoch added lines ≥ this share of epoch size = "rewritten". */
export const REWRITE_SHARE = 0.5;
/** Months are approximated as 30 days (documented, deterministic). */
const DAYS_PER_MONTH = 30;

export type Outcome = "deleted" | "rewritten" | "heavily-patched" | "quiet";

/** Outcomes that count as corrective events. "split" is NOT labeled in
 * M1 — no reliable static detector; disclosed rather than faked. */
export const CORRECTIVE_OUTCOMES: Outcome[] = [
  "deleted",
  "rewritten",
  "heavily-patched",
];

export interface FileOutcome {
  path: string;
  outcome: Outcome;
  epochCodeLines: number;
  addedInWindow: number;
  touchesInWindow: number;
}

/**
 * Pure labeling: post-epoch commits only (tautology guard — callers pass
 * commits strictly after the epoch date).
 */
export function labelOutcomes(
  epochFiles: Map<string, number>,
  postEpochCommits: CommitRecord[],
  headTracked: Set<string>,
  renames: Map<string, string>,
): Map<string, FileOutcome> {
  const follow = (path: string): string => {
    let current = path;
    const visited = new Set([current]);
    while (renames.has(current)) {
      const next = renames.get(current) as string;
      if (visited.has(next)) break;
      visited.add(next);
      current = next;
    }
    return current;
  };

  const added = new Map<string, number>();
  const touches = new Map<string, number>();
  for (const commit of postEpochCommits) {
    for (const file of commit.files) {
      added.set(file.path, (added.get(file.path) ?? 0) + file.added);
      touches.set(file.path, (touches.get(file.path) ?? 0) + 1);
    }
  }

  const outcomes = new Map<string, FileOutcome>();
  for (const [path, epochCodeLines] of epochFiles) {
    const finalPath = headTracked.has(path) ? path : follow(path);
    const survived = headTracked.has(finalPath);
    // Window stats accrue to the file under both its old and new names.
    const addedInWindow =
      (added.get(path) ?? 0) + (finalPath !== path ? (added.get(finalPath) ?? 0) : 0);
    const touchesInWindow =
      (touches.get(path) ?? 0) +
      (finalPath !== path ? (touches.get(finalPath) ?? 0) : 0);

    let outcome: Outcome;
    if (!survived) outcome = "deleted";
    else if (epochCodeLines > 0 && addedInWindow >= REWRITE_SHARE * epochCodeLines)
      outcome = "rewritten";
    else if (touchesInWindow >= HEAVY_PATCH_TOUCHES) outcome = "heavily-patched";
    else outcome = "quiet";

    outcomes.set(path, {
      path,
      outcome,
      epochCodeLines,
      addedInWindow,
      touchesInWindow,
    });
  }
  return outcomes;
}

export interface GroupLift {
  name: string;
  files: number;
  correctiveRate: number;
  controls: number;
  controlRate: number;
  /** correctiveRate ÷ controlRate; null when no controls matched. */
  lift: number | null;
}

function isCorrective(outcome: Outcome): boolean {
  return CORRECTIVE_OUTCOMES.includes(outcome);
}

/**
 * Size-matched controls: greedy nearest-codeLines match from the control
 * pool, without replacement. The base rate travels with every lift.
 */
export function computeGroupLift(
  name: string,
  treatment: string[],
  controlPool: string[],
  outcomes: Map<string, FileOutcome>,
): GroupLift {
  const rate = (paths: string[]): number =>
    paths.length === 0
      ? 0
      : paths.filter((p) => {
          const o = outcomes.get(p);
          return o !== undefined && isCorrective(o.outcome);
        }).length / paths.length;

  const available = controlPool
    .filter((p) => outcomes.has(p))
    .map((p) => ({ path: p, size: outcomes.get(p)?.epochCodeLines ?? 0 }));
  const controls: string[] = [];
  for (const path of treatment) {
    const size = outcomes.get(path)?.epochCodeLines ?? 0;
    let bestIdx = -1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < available.length; i++) {
      const diff = Math.abs(available[i].size - size);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      controls.push(available[bestIdx].path);
      available.splice(bestIdx, 1);
    }
  }

  const correctiveRate = rate(treatment);
  const controlRate = rate(controls);
  return {
    name,
    files: treatment.length,
    correctiveRate,
    controls: controls.length,
    controlRate,
    lift:
      controls.length === 0 || controlRate === 0
        ? null
        : correctiveRate / controlRate,
  };
}

export interface BacktestReport {
  repo: string;
  epochSha: string;
  epochDate: string;
  headSha: string;
  monthsBack: number;
  labeledFiles: number;
  baseRates: Record<Outcome, number>;
  groups: GroupLift[];
}

function git(rootPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

export async function runBacktest(options: {
  rootPath: string;
  monthsBack: number;
}): Promise<BacktestReport> {
  const { rootPath, monthsBack } = options;
  const history = collectGitHistory(rootPath);
  if (!history) throw new Error("Backtest needs a git repository with history.");

  const epochCutoff = new Date(
    Date.parse(history.anchorDate) -
      monthsBack * DAYS_PER_MONTH * 24 * 60 * 60 * 1000,
  ).toISOString();
  const epochSha = git(rootPath, [
    "rev-list",
    "-1",
    `--before=${epochCutoff}`,
    "HEAD",
  ]);
  if (!epochSha) {
    throw new Error(
      `No commit exists ${monthsBack} months before HEAD (${epochCutoff}).`,
    );
  }

  // Audit the epoch in a detached worktree; never touch its ledger.
  const epochDir = mkdtempSync(join(tmpdir(), "vibecheck-backtest-"));
  let epochResult;
  try {
    git(rootPath, ["worktree", "add", "--detach", epochDir, epochSha]);
    epochResult = await runAudit({ rootPath: epochDir, stampLedger: false });
  } finally {
    try {
      git(rootPath, ["worktree", "remove", "--force", epochDir]);
    } catch {
      rmSync(epochDir, { recursive: true, force: true });
    }
  }

  const epochDate = epochResult.history?.anchorDate ?? epochCutoff;
  const epochFiles = new Map(
    (epochResult.lanes.size?.entries ?? []).map((e) => [e.path, e.codeLines]),
  );
  if (epochFiles.size === 0) {
    throw new Error(
      "Epoch audit measured no files — is scc installed? The backtest needs the size substrate.",
    );
  }

  // Tautology guard: labels consume commits strictly after the epoch.
  const postEpochCommits = history.commits.filter(
    (c) => !c.isMerge && Date.parse(c.date) > Date.parse(epochDate),
  );
  const headTracked = new Set(
    git(rootPath, ["ls-files", "-z"]).split("\0").filter(Boolean),
  );
  const outcomes = labelOutcomes(
    epochFiles,
    postEpochCommits,
    headTracked,
    collectRenames(rootPath),
  );

  const baseRates = { deleted: 0, rewritten: 0, "heavily-patched": 0, quiet: 0 };
  for (const o of outcomes.values()) baseRates[o.outcome]++;
  for (const key of Object.keys(baseRates) as Outcome[]) {
    baseRates[key] = outcomes.size === 0 ? 0 : baseRates[key] / outcomes.size;
  }

  const scores = epochResult.fileScores.filter((f) => outcomes.has(f.path));
  const decile = (paths: { path: string; value: number }[]): string[] => {
    const sorted = [...paths].sort(
      (a, b) => b.value - a.value || (a.path < b.path ? -1 : 1),
    );
    return sorted.slice(0, Math.max(1, Math.floor(sorted.length / 10))).map(
      (p) => p.path,
    );
  };

  const gatePassing = scores.filter((f) => f.gatePassed);
  const singleLane = scores.filter(
    (f) => f.firingLanes.length === 1 && !f.gatePassed,
  );
  const quietFiles = scores
    .filter((f) => f.firingLanes.length === 0)
    .map((f) => f.path);

  const groups: GroupLift[] = [
    computeGroupLift(
      "gate-passing top decile (weighted score)",
      decile(gatePassing.map((f) => ({ path: f.path, value: f.weightedScore }))),
      quietFiles,
      outcomes,
    ),
    computeGroupLift(
      "single-lane top decile (no-override falsification)",
      decile(
        singleLane.map((f) => ({
          path: f.path,
          value: f.firingLanes[0]?.score ?? 0,
        })),
      ),
      quietFiles,
      outcomes,
    ),
  ];
  for (const lane of ["size", "arrival"]) {
    const laneScores = scores
      .filter((f) => f.firingLanes.some((fl) => fl.lane === lane))
      .map((f) => ({
        path: f.path,
        value: f.firingLanes.find((fl) => fl.lane === lane)?.score ?? 0,
      }));
    if (laneScores.length > 0) {
      groups.push(
        computeGroupLift(
          `${lane} lane firing top decile`,
          decile(laneScores),
          quietFiles,
          outcomes,
        ),
      );
    }
  }

  return {
    repo: rootPath,
    epochSha,
    epochDate,
    headSha: history.anchorSha,
    monthsBack,
    labeledFiles: outcomes.size,
    baseRates,
    groups,
  };
}

export function renderBacktestReport(report: BacktestReport): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lines = [
    `Backtest: ${report.monthsBack} months back`,
    `  epoch ${report.epochSha.slice(0, 12)} (${report.epochDate.slice(0, 10)}) → head ${report.headSha.slice(0, 12)}`,
    `  ${report.labeledFiles} files labeled`,
    `  base rates: ` +
      (Object.entries(report.baseRates) as [Outcome, number][])
        .map(([k, v]) => `${k} ${pct(v)}`)
        .join(", "),
    ``,
    `  ${"group".padEnd(48)} n    corrective  controls  ctrl-rate  lift`,
  ];
  for (const g of report.groups) {
    lines.push(
      `  ${g.name.padEnd(48)} ${String(g.files).padEnd(4)} ${pct(g.correctiveRate).padEnd(11)} ${String(g.controls).padEnd(9)} ${pct(g.controlRate).padEnd(10)} ${g.lift === null ? "n/a" : g.lift.toFixed(2)}`,
    );
  }
  lines.push(
    "",
    "  Read with the base rate next to every lift; size-matched controls",
    "  drawn from non-firing files without replacement.",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let rootPath = process.cwd();
  let monthsBack = 12;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) rootPath = args[++i];
    else if (args[i] === "--months" && args[i + 1]) monthsBack = Number(args[++i]);
  }
  const report = await runBacktest({ rootPath, monthsBack });
  console.log(renderBacktestReport(report));
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
