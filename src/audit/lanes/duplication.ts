/**
 * L2 · Duplication lane (outcome-predictive)
 *
 * jscpd clone pairs → per-file duplicated-line share (interval-merged so
 * overlapping clones never double-count) + cluster fan-out (how many
 * distinct partner files share the clones). Density = duplicated share;
 * fan-out is evidence, not score.
 */

import type { ResolvedAuditConfig } from "../config.js";
import { runJscpd, type JscpdResult } from "../runners/jscpd.js";

export interface DuplicationLaneEntry {
  path: string;
  duplicatedLines: number;
  codeLines: number;
  /** Distinct files sharing at least one clone with this one. */
  clusterFanOut: number;
  /** Lane density: duplicated lines ÷ scc code lines (0..1-ish). */
  score: number;
}

export interface DuplicationLaneResult {
  lane: "duplication";
  available: boolean;
  disclosure?: string;
  entries: DuplicationLaneEntry[];
}

function mergedCoverage(intervals: [number, number][]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0];
  for (const [s, e] of sorted.slice(1)) {
    if (s > end + 1) {
      total += end - start + 1;
      [start, end] = [s, e];
    } else if (e > end) {
      end = e;
    }
  }
  total += end - start + 1;
  return total;
}

/** Pure core — testable without the jscpd binary. */
export function buildDuplicationLane(
  jscpd: JscpdResult,
  candidateFiles: string[],
  codeLines: Map<string, number>,
): DuplicationLaneResult {
  if (!jscpd.available) {
    return {
      lane: "duplication",
      available: false,
      disclosure:
        "jscpd not available — duplication lane skipped (bundled with vibecheck; npx could not resolve it)",
      entries: [],
    };
  }

  const candidates = new Set(candidateFiles);
  const intervals = new Map<string, [number, number][]>();
  const partners = new Map<string, Set<string>>();
  const add = (file: string, start: number, end: number, partner: string) => {
    if (!candidates.has(file)) return;
    const list = intervals.get(file) ?? [];
    list.push([start, end]);
    intervals.set(file, list);
    const set = partners.get(file) ?? new Set<string>();
    if (partner !== file) set.add(partner);
    partners.set(file, set);
  };
  for (const clone of jscpd.clones) {
    add(clone.fileA, clone.startA, clone.endA, clone.fileB);
    add(clone.fileB, clone.startB, clone.endB, clone.fileA);
  }

  const entries: DuplicationLaneEntry[] = [];
  for (const [path, list] of intervals) {
    const duplicatedLines = mergedCoverage(list);
    const lines = codeLines.get(path) ?? 0;
    entries.push({
      path,
      duplicatedLines,
      codeLines: lines,
      clusterFanOut: partners.get(path)?.size ?? 0,
      // Without scc the share is unknowable; keep the entry with score 0
      // rather than invent a denominator.
      score: lines > 0 ? Math.min(1, duplicatedLines / lines) : 0,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { lane: "duplication", available: true, entries };
}

export function runDuplicationLane(
  rootPath: string,
  candidateFiles: string[],
  codeLines: Map<string, number>,
  config: ResolvedAuditConfig,
): DuplicationLaneResult {
  return buildDuplicationLane(
    runJscpd(rootPath, config.lanes.duplication.minLines),
    candidateFiles,
    codeLines,
  );
}
