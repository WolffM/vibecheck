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
import { collectGitHistory, type GitHistory } from "./git-arrival.js";
import { runArrivalLane, type ArrivalLaneResult } from "./lanes/arrival.js";
import { runSizeLane, type SizeLaneResult } from "./lanes/size.js";

export interface AuditOptions {
  rootPath?: string;
  configPath?: string;
  /** CI cost guard; local runs never gate unless explicitly asked (design §7). */
  gate?: boolean;
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

  const lanes: AuditRunResult["lanes"] = {};
  if (config.lanes.size.enabled) {
    lanes.size = runSizeLane(rootPath, kept, config);
  }
  if (config.lanes.arrival.enabled) {
    lanes.arrival = runArrivalLane(rootPath, history, kept);
  }

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
  };
}
