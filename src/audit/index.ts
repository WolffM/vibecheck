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
import { applyExclusions, type Exclusion } from "./exclusions.js";
import {
  collectGitHistory,
  collectRenames,
  type GitHistory,
} from "./git-arrival.js";
import { buildImportGraph } from "./import-graph.js";
import {
  appendEvents,
  computeRenameEvents,
  computeRunEvents,
  floorsForScoring,
  foldLedger,
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
  LANE_ANCHORS,
  scoreFiles,
  worstOffenders,
  type FileScore,
  type LaneScore,
} from "./scoring.js";

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
  };
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

  // M1 lanes; T3 (size) and T5 (arrival) replace this stub with real runs.
  const lanesPlanned = (["size", "arrival"] as const).filter(
    (lane) => config.lanes[lane].enabled,
  );

  const { kept, excluded } = applyExclusions(
    rootPath,
    listTrackedFiles(rootPath),
  );

  const history = collectGitHistory(rootPath);
  const importGraph = buildImportGraph(rootPath, kept);

  const lanes: AuditRunResult["lanes"] = {};
  if (config.lanes.size.enabled) {
    lanes.size = runSizeLane(rootPath, kept, config);
  }
  if (config.lanes.arrival.enabled) {
    lanes.arrival = runArrivalLane(rootPath, history, kept, importGraph);
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
  ];
  const codeLines = new Map(
    (lanes.size?.entries ?? []).map((e) => [e.path, e.codeLines]),
  );

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

  const suppressed: ResolvedVerdict[] = [];
  const reopened: string[] = [];
  const laneScores = allLaneScores.filter((score) => {
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
  const runEvents = computeRunEvents(fold, currentScores, anchorDate);
  if (stampLedger && runEvents.length > 0) appendEvents(rootPath, runEvents);

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
    fileScores,
    worstOffenders: worstOffenders(fileScores, config.maxReportItems),
    bestFirstTargets: bestFirstTargets(fileScores, blastRadius),
    ledger: {
      floors,
      suppressed,
      agingJustifications,
      reopened,
      stampedEvents: renameEvents.length + runEvents.length,
    },
  };
}
