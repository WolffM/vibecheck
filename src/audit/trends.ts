/**
 * Trends (design §6)
 *
 * .vibecompact/trends.json holds one entry per run: anchor SHA/date, tool
 * versions, standing floors, per-lane aggregates, dirty flag. The health
 * summary leads with the *derivative*: current run vs the most recent
 * clean entry at least 21 days older. Calibration immunity: floor and
 * tool-version changes flag a trend break instead of silently absorbing;
 * findings suppressed by a raised floor never count as improvement.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TRENDS_PATH = ".vibecompact/trends.json";
/** Minimum baseline age for derivative comparisons (days). */
export const TREND_BASELINE_MIN_DAYS = 21;
/** Ring-buffer cap on stored entries. */
const MAX_ENTRIES = 500;

export interface LaneAggregate {
  /** Files the lane could judge at all. */
  filesAssessed: number;
  /** Files at or above the lane's firing threshold. */
  filesFlagged: number;
}

/** Pre-rename entries used `measured`/`firing`. */
interface LegacyLaneAggregate {
  measured?: number;
  firing?: number;
}

function laneAggregate(raw: LaneAggregate & LegacyLaneAggregate): LaneAggregate {
  return {
    filesAssessed: raw.filesAssessed ?? raw.measured ?? 0,
    filesFlagged: raw.filesFlagged ?? raw.firing ?? 0,
  };
}

export interface TrendEntry {
  at: string;
  sha: string;
  dirty: boolean;
  toolVersions: Record<string, string | null>;
  floors: Record<string, number>;
  /** Lanes muted by repo saturation at this run (v0.3). */
  saturated?: string[];
  aggregates: {
    candidateFiles: number;
    perLane: Record<string, LaneAggregate>;
    gatePassing: number;
    offenders: number;
    suppressedByFloor: number;
  };
}

export interface TrendDerivative {
  baselineAt: string;
  baselineSha: string;
  spanDays: number;
  /** Positive = more offenders than the baseline (worse). */
  offendersDelta: number;
  firingDelta: Record<string, number>;
  /** Deltas spanning these breaks are flagged, not silently comparable. */
  trendBreaks: string[];
  /** Offender-count improvement discounted for floor suppression. */
  suppressedByFloorExcluded: number;
}

export function readTrends(rootPath: string): TrendEntry[] {
  const file = join(rootPath, TRENDS_PATH);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as TrendEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`trends: unparseable ${file}; starting fresh`);
    return [];
  }
}

/**
 * Append (or, for a rerun at the same SHA and dirtiness, replace) the
 * entry and persist. Returns the updated list.
 */
export function appendTrendEntry(
  rootPath: string,
  entry: TrendEntry,
): TrendEntry[] {
  const entries = readTrends(rootPath);
  const last = entries[entries.length - 1];
  if (last && last.sha === entry.sha && last.dirty === entry.dirty) {
    entries[entries.length - 1] = entry;
  } else {
    entries.push(entry);
  }
  const trimmed = entries.slice(-MAX_ENTRIES);
  const file = join(rootPath, TRENDS_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
  return trimmed;
}

/** Latest clean entry at least TREND_BASELINE_MIN_DAYS older than current. */
export function selectBaseline(
  entries: TrendEntry[],
  current: TrendEntry,
): TrendEntry | null {
  const currentTime = Date.parse(current.at);
  const minAgeMs = TREND_BASELINE_MIN_DAYS * 24 * 60 * 60 * 1000;
  let best: TrendEntry | null = null;
  for (const entry of entries) {
    if (entry === current || entry.dirty) continue;
    if (currentTime - Date.parse(entry.at) < minAgeMs) continue;
    if (!best || entry.at > best.at) best = entry;
  }
  return best;
}

export function computeDerivative(
  entries: TrendEntry[],
  current: TrendEntry,
): TrendDerivative | null {
  const baseline = selectBaseline(entries, current);
  if (!baseline) return null;

  const trendBreaks: string[] = [];
  const tools = new Set([
    ...Object.keys(baseline.toolVersions),
    ...Object.keys(current.toolVersions),
  ]);
  for (const tool of tools) {
    const from = baseline.toolVersions[tool] ?? null;
    const to = current.toolVersions[tool] ?? null;
    if (from !== to) {
      trendBreaks.push(`tool-version: ${tool} ${from ?? "absent"} → ${to ?? "absent"}`);
    }
  }
  const lanes = new Set([
    ...Object.keys(baseline.floors),
    ...Object.keys(current.floors),
  ]);
  for (const lane of lanes) {
    const from = baseline.floors[lane] ?? 0;
    const to = current.floors[lane] ?? 0;
    if (from !== to) {
      trendBreaks.push(`floor: ${lane} ${from} → ${to}`);
    }
  }
  const fromSat = (baseline.saturated ?? []).join(",");
  const toSat = (current.saturated ?? []).join(",");
  if (fromSat !== toSat) {
    trendBreaks.push(
      `saturation: [${fromSat || "none"}] → [${toSat || "none"}]`,
    );
  }

  const firingDelta: Record<string, number> = {};
  const laneNames = new Set([
    ...Object.keys(baseline.aggregates.perLane),
    ...Object.keys(current.aggregates.perLane),
  ]);
  for (const lane of laneNames) {
    firingDelta[lane] =
      laneAggregate(current.aggregates.perLane[lane] ?? {}).filesFlagged -
      laneAggregate(baseline.aggregates.perLane[lane] ?? {}).filesFlagged;
  }

  // A raised floor hides findings; that hiding is not an improvement.
  const suppressedByFloorExcluded = Math.max(
    0,
    current.aggregates.suppressedByFloor - baseline.aggregates.suppressedByFloor,
  );
  const rawDelta = current.aggregates.offenders - baseline.aggregates.offenders;
  const offendersDelta = rawDelta + suppressedByFloorExcluded;

  return {
    baselineAt: baseline.at,
    baselineSha: baseline.sha,
    spanDays: Math.floor(
      (Date.parse(current.at) - Date.parse(baseline.at)) /
        (24 * 60 * 60 * 1000),
    ),
    offendersDelta,
    firingDelta,
    trendBreaks,
    suppressedByFloorExcluded,
  };
}
