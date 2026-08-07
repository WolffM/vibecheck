/**
 * vibeCheck Audit — orchestrator
 *
 * Core of the audit mode (design: docs/vibe-compactor-plan.md §9). This
 * module and everything it imports must stay free of GitHub API imports;
 * publishing beyond the local sink lives in `publish/` and is wired in only
 * by the action.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { loadVibeCopConfig } from "../core/config-loader.js";
import { resolveAuditConfig, type ResolvedAuditConfig } from "./config.js";
import { detectEntryPoints } from "./entrypoints.js";
import { applyExclusions, type Exclusion } from "./exclusions.js";
import {
  collectGitHistory,
  collectRenames,
  type GitHistory,
} from "./git-arrival.js";
import { buildImportData } from "./import-graph.js";
import {
  buildConsistencyLane,
  type ConsistencyLaneResult,
} from "./lanes/consistency.js";
import { runDeadcodeLane, type DeadcodeLaneResult } from "./lanes/deadcode.js";
import {
  runDuplicationLane,
  type DuplicationLaneResult,
} from "./lanes/duplication.js";
import { runSmellsLane, type SmellsLaneResult } from "./lanes/smells.js";
import {
  appendEvents,
  computeRenameEvents,
  computeRunEvents,
  floorsForScoring,
  foldLedger,
  laneOf,
  makeFingerprint,
  readLedger,
  resolveVerdict,
  type ResolvedVerdict,
  type VerdictEvent,
} from "./ledger.js";
import { runArrivalLane, type ArrivalLaneResult } from "./lanes/arrival.js";
import { runSizeLane, type SizeLaneResult } from "./lanes/size.js";
import {
  bestFirstTargets,
  computeBlastRadius,
  detectSaturatedLanes,
  LANE_ANCHORS,
  scoreFiles,
  worstOffenders,
  type FileScore,
  type LaneScore,
} from "./scoring.js";
import {
  appendTrendEntry,
  computeDerivative,
  readTrends,
  type TrendDerivative,
  type TrendEntry,
} from "./trends.js";

export interface AuditOptions {
  rootPath?: string;
  configPath?: string;
  /** CI cost guard; local runs never gate unless explicitly asked (design §7). */
  gate?: boolean;
  /** Append firing/fixed/rename events to the ledger (default true). */
  stampLedger?: boolean;
}

export interface AuditRunResult {
  rootPath: string;
  config: ResolvedAuditConfig;
  /** HEAD SHA the run is anchored to, or null outside a git repo. */
  anchorSha: string | null;
  /** True when the working tree has uncommitted changes (trends: dirty entry). */
  dirty: boolean;
  lanesPlanned: string[];
  /** Tracked files that survived the exclusion pre-pass (design §3). */
  candidateFiles: string[];
  excluded: Exclusion[];
  history: GitHistory | null;
  lanes: {
    size?: SizeLaneResult;
    arrival?: ArrivalLaneResult;
    deadcode?: DeadcodeLaneResult;
    duplication?: DuplicationLaneResult;
    smells?: SmellsLaneResult;
    consistency?: ConsistencyLaneResult;
  };
  /** Raw per-lane scores before verdict suppression (calibration input). */
  laneScores: LaneScore[];
  /** Per-file gate/rank results across all lanes. */
  fileScores: FileScore[];
  worstOffenders: FileScore[];
  bestFirstTargets: FileScore[];
  ledger: {
    /** Absolute per-lane floors applied this run (attested ratchet). */
    floors: Record<string, number>;
    /** Lane findings suppressed by standing verdicts. */
    suppressed: ResolvedVerdict[];
    /** Justifications past their age expiry — refresh-and-quote list. */
    agingJustifications: VerdictEvent[];
    /** Fingerprints hard-reopened by growth invalidation. */
    reopened: string[];
    /** Machine events (firing/fixed/rename) appended by this run. */
    stampedEvents: number;
    /** Still-firing fingerprints whose score dropped ≥10% since they
     * first fired — "improved, still flagged" (partial-fix framing). */
    improving: Record<string, number>;
  };
  /** Lanes muted this run by repo saturation (lane → firing rate). */
  saturatedLanes: Record<string, number>;
  /** Declared entry points detected (count only; detail in machine artifact). */
  entryPointCount: number;
  trends: {
    entry: TrendEntry;
    /** Null until a clean ≥21-day-old baseline exists. */
    derivative: TrendDerivative | null;
  };
}

function listTrackedFiles(rootPath: string): string[] {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return output.split("\0").filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

function gitHead(rootPath: string): { sha: string | null; dirty: boolean } {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { sha, dirty: status.trim().length > 0 };
  } catch {
    return { sha: null, dirty: false };
  }
}

export async function runAudit(
  options: AuditOptions = {},
): Promise<AuditRunResult> {
  const rootPath = resolve(options.rootPath ?? process.cwd());
  if (!existsSync(rootPath)) {
    throw new Error(`Root path does not exist: ${rootPath}`);
  }

  const repoConfig = loadVibeCopConfig(rootPath, options.configPath);
  const config = resolveAuditConfig(repoConfig.audit);
  const { sha, dirty } = gitHead(rootPath);

  const lanesPlanned = (
    ["size", "arrival", "deadcode", "duplication", "smells", "consistency"] as const
  ).filter((lane) => config.lanes[lane].enabled);

  const { kept, excluded } = applyExclusions(
    rootPath,
    listTrackedFiles(rootPath),
    config.exclude,
  );

  const history = collectGitHistory(rootPath);
  const importData = buildImportData(rootPath, kept);
  const importGraph = importData.graph;

  const entryPoints = detectEntryPoints(rootPath, kept);

  const lanes: AuditRunResult["lanes"] = {};
  if (config.lanes.size.enabled) {
    lanes.size = runSizeLane(rootPath, kept, config);
  }
  const codeLines = new Map(
    (lanes.size?.entries ?? []).map((e) => [e.path, e.codeLines]),
  );
  if (config.lanes.arrival.enabled) {
    lanes.arrival = runArrivalLane(rootPath, history, kept, importGraph);
  }
  if (config.lanes.deadcode.enabled) {
    lanes.deadcode = runDeadcodeLane(rootPath, kept, entryPoints.entries);
  }
  if (config.lanes.duplication.enabled) {
    lanes.duplication = runDuplicationLane(rootPath, kept, codeLines, config);
  }
  if (config.lanes.smells.enabled) {
    lanes.smells = runSmellsLane(rootPath, kept, codeLines);
  }
  if (config.lanes.consistency.enabled) {
    lanes.consistency = buildConsistencyLane(
      rootPath,
      kept,
      importData,
      entryPoints.entries,
    );
  }

  const allLaneScores: LaneScore[] = [
    ...(lanes.size?.entries.map((e) => ({
      lane: "size",
      path: e.path,
      score: e.score,
      applicable: true,
    })) ?? []),
    ...(lanes.arrival?.entries.map((e) => ({
      lane: "arrival",
      path: e.path,
      score: e.score,
      applicable: e.applicable,
    })) ?? []),
    ...(lanes.deadcode?.entries.map((e) => ({
      lane: "deadcode",
      path: e.path,
      score: e.score,
      applicable: e.applicable,
    })) ?? []),
    // Duplication entries exist only for files with clones; clone-free
    // files are still applicable when the tool ran.
    ...(lanes.duplication?.available
      ? (() => {
          const byPath = new Map(
            (lanes.duplication?.entries ?? []).map((e) => [e.path, e.score]),
          );
          return kept
            .filter((path) => codeLines.has(path))
            .map((path) => ({
              lane: "duplication",
              path,
              score: byPath.get(path) ?? 0,
              applicable: true,
            }));
        })()
      : []),
    ...(lanes.smells?.entries.map((e) => ({
      lane: "smells",
      path: e.path,
      score: e.score,
      applicable: e.applicable,
    })) ?? []),
    ...(lanes.consistency?.entries.map((e) => ({
      lane: "consistency",
      path: e.path,
      score: e.score,
      applicable: e.applicable,
    })) ?? []),
  ];

  // Ledger: rename migration first, then verdicts/floors from the fold.
  const anchorDate = history?.anchorDate ?? new Date(0).toISOString();
  let fold = foldLedger(readLedger(rootPath));
  const renameEvents = computeRenameEvents(
    fold,
    collectRenames(rootPath),
    new Set(kept),
    anchorDate,
  );
  const stampLedger = options.stampLedger ?? true;
  if (renameEvents.length > 0) {
    if (stampLedger) appendEvents(rootPath, renameEvents);
    fold = foldLedger([...fold.events, ...renameEvents]);
  }
  const floors = floorsForScoring(fold);
  const verdictCtx = { anchorDate, codeLines };

  // Repo-saturation mute (v0.3): a lane at ceiling carries a repo-level
  // fact, not per-file corroboration. Detected pre-suppression so human
  // verdicts can't unmute a lane by thinning its firing set.
  const saturated = detectSaturatedLanes(allLaneScores, floors);
  const saturatedLanes = new Set(saturated.keys());

  const suppressed: ResolvedVerdict[] = [];
  const reopened: string[] = [];
  const laneScores = allLaneScores.filter((score) => {
    if (saturatedLanes.has(score.lane)) return false;
    const resolved = resolveVerdict(
      fold,
      makeFingerprint(score.lane, score.path),
      verdictCtx,
    );
    if (resolved.status === "reopened-growth") reopened.push(resolved.fingerprint);
    if (resolved.suppressed) {
      suppressed.push(resolved);
      return false;
    }
    return true;
  });
  const agingJustifications = [...fold.verdicts.keys()]
    .map((fp) => resolveVerdict(fold, fp, verdictCtx))
    .filter((r) => r.status === "justified-aging")
    .map((r) => r.event as VerdictEvent);

  const fileScores = scoreFiles(laneScores, { floors });
  const blastRadius = computeBlastRadius(codeLines, importGraph);

  // Stamp firing/fixed machine events for unsuppressed lane findings,
  // anchored to the audit date (never wall clock).
  const currentScores = new Map(
    laneScores
      .filter((s) => s.applicable)
      .map((s) => [
        makeFingerprint(s.lane, s.path),
        {
          score: s.score,
          threshold: Math.max(
            LANE_ANCHORS[s.lane] ?? Number.POSITIVE_INFINITY,
            floors[s.lane] ?? 0,
          ),
        },
      ]),
  );
  const runEvents = computeRunEvents(
    fold,
    currentScores,
    anchorDate,
    saturatedLanes,
  );
  if (stampLedger && runEvents.length > 0) appendEvents(rootPath, runEvents);

  // Partial-fix acknowledgment: still firing, but meaningfully down from
  // the score it originally fired at ("improved, still flagged").
  const improving: Record<string, number> = {};
  for (const [fingerprint, state] of fold.firing) {
    if (state.fixedAt || saturatedLanes.has(laneOf(fingerprint))) continue;
    const current = currentScores.get(fingerprint);
    if (!current || current.score < current.threshold) continue;
    if (state.score > 0 && current.score <= state.score * 0.9) {
      improving[fingerprint] = Math.round(
        (1 - current.score / state.score) * 100,
      );
    }
  }

  const offenders = worstOffenders(fileScores, config.maxReportItems);
  const trendEntry: TrendEntry = {
    at: anchorDate,
    sha: sha ?? "no-git",
    dirty,
    toolVersions: { scc: lanes.size?.toolVersion ?? null },
    floors,
    saturated: [...saturatedLanes].sort(),
    aggregates: {
      candidateFiles: kept.length,
      perLane: Object.fromEntries(
        lanesPlanned.map((lane) => [
          lane,
          {
            measured: allLaneScores.filter(
              (s) => s.lane === lane && s.applicable,
            ).length,
            firing: fileScores.filter((f) =>
              f.firingLanes.some((fl) => fl.lane === lane),
            ).length,
          },
        ]),
      ),
      gatePassing: fileScores.filter((f) => f.gatePassed).length,
      offenders: offenders.length,
      suppressedByFloor: fileScores.reduce(
        (sum, f) => sum + f.suppressedByFloor.length,
        0,
      ),
    },
  };
  const priorTrends = readTrends(rootPath);
  const derivative = computeDerivative(priorTrends, trendEntry);
  if (stampLedger) appendTrendEntry(rootPath, trendEntry);

  return {
    rootPath,
    config,
    anchorSha: sha,
    dirty,
    lanesPlanned: [...lanesPlanned],
    candidateFiles: kept,
    excluded,
    history,
    lanes,
    laneScores: allLaneScores,
    fileScores,
    worstOffenders: offenders,
    bestFirstTargets: bestFirstTargets(fileScores, blastRadius),
    ledger: {
      floors,
      suppressed,
      agingJustifications,
      reopened,
      stampedEvents: renameEvents.length + runEvents.length,
      improving,
    },
    saturatedLanes: Object.fromEntries(saturated),
    entryPointCount: entryPoints.entries.size,
    trends: {
      entry: trendEntry,
      derivative,
    },
  };
}
