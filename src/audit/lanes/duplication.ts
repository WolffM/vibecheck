/**
 * L2 · Duplication lane (outcome-predictive)
 *
 * jscpd clone pairs → per-file duplicated-line share (interval-merged so
 * overlapping clones never double-count) + cluster fan-out (how many
 * distinct partner files share the clones). Density = duplicated share;
 * fan-out is evidence, not score.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedAuditConfig } from "../config.js";
import { runJscpd, type JscpdResult } from "../runners/jscpd.js";

export interface CloneRef {
  /** Line range in this file. */
  start: number;
  end: number;
  /** Partner file ("" = same file, internal duplication) + its range. */
  partner: string;
  partnerStart: number;
  partnerEnd: number;
}

export interface DuplicationLaneEntry {
  path: string;
  duplicatedLines: number;
  codeLines: number;
  /** Distinct files sharing at least one clone with this one. */
  clusterFanOut: number;
  /** The largest clone pairs, exact ranges (capped at 5). */
  clones: CloneRef[];
  /** Lane density: duplicated lines ÷ scc code lines (0..1-ish). */
  score: number;
}

/**
 * Cross-directory clone concentration: when two directories share this
 * many cloned lines, one reads as a drifted copy of the other — a
 * structure-level fact said once at repo level, not a style opinion
 * (folder taste stays out of scope; consequences don't). Hand-set
 * behavioral constant (§10.1).
 */
export const DIR_PAIR_MIN_LINES = 150;

export interface DirPairConcentration {
  dirA: string;
  dirB: string;
  /** Cloned lines shared between the two directories (A-side extent). */
  lines: number;
  blocks: number;
  filePairs: number;
}

export interface DuplicationLaneResult {
  lane: "duplication";
  available: boolean;
  disclosure?: string;
  entries: DuplicationLaneEntry[];
  /** Directory pairs above DIR_PAIR_MIN_LINES, worst first. */
  dirPairs: DirPairConcentration[];
}

/**
 * Lines inside a span that scc would also count as code. jscpd reports
 * raw line spans while the denominator is scc's code lines, so a clone
 * straddling a doc-comment block inflates the density score (#387): one
 * "45 duplicated lines" finding was 5 imports, 2 consts and ~38 lines of
 * per-spec comment scaffolding. Counting on the same basis as the
 * denominator is the whole fix.
 */
export function countCodeLinesInSpan(
  lines: string[],
  start: number,
  end: number,
): number {
  let count = 0;
  let inBlock = false;
  for (let i = start - 1; i < Math.min(end, lines.length); i++) {
    const text = (lines[i] ?? "").trim();
    if (inBlock) {
      if (text.includes("*/")) inBlock = false;
      continue;
    }
    if (!text) continue;
    if (text.startsWith("/*")) {
      if (!text.includes("*/")) inBlock = true;
      continue;
    }
    if (text.startsWith("//") || text.startsWith("*") || text.startsWith("#")) {
      continue;
    }
    count++;
  }
  return count;
}

export function mergedIntervals(
  intervals: [number, number][],
): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let [start, end] = sorted[0];
  for (const [s, e] of sorted.slice(1)) {
    if (s > end + 1) {
      out.push([start, end]);
      [start, end] = [s, e];
    } else if (e > end) {
      end = e;
    }
  }
  out.push([start, end]);
  return out;
}

function mergedCoverage(intervals: [number, number][]): number {
  return mergedIntervals(intervals).reduce((sum, [a, b]) => sum + (b - a + 1), 0);
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

/** Aggregate clone pairs by (unordered) directory pair, exact counts. */
export function computeDirPairs(
  clones: JscpdResult["clones"],
  candidates: Set<string>,
  minLines = DIR_PAIR_MIN_LINES,
): DirPairConcentration[] {
  const acc = new Map<
    string,
    {
      dirA: string;
      dirB: string;
      lines: number;
      blocks: number;
      filePairs: Set<string>;
    }
  >();
  for (const clone of clones) {
    if (!candidates.has(clone.fileA) || !candidates.has(clone.fileB)) continue;
    const dirA = parentDir(clone.fileA);
    const dirB = parentDir(clone.fileB);
    // Same-dir (including same-file) duplication is the per-file story;
    // the structure signal is specifically cross-directory.
    if (dirA === dirB) continue;
    const [a, b] = dirA < dirB ? [dirA, dirB] : [dirB, dirA];
    const key = `${a}|${b}`;
    const cur = acc.get(key) ?? {
      dirA: a,
      dirB: b,
      lines: 0,
      blocks: 0,
      filePairs: new Set<string>(),
    };
    cur.lines += clone.endA - clone.startA + 1;
    cur.blocks++;
    cur.filePairs.add(
      clone.fileA < clone.fileB
        ? `${clone.fileA}|${clone.fileB}`
        : `${clone.fileB}|${clone.fileA}`,
    );
    acc.set(key, cur);
  }
  return [...acc.values()]
    .filter((v) => v.lines >= minLines)
    .map((v) => ({
      dirA: v.dirA,
      dirB: v.dirB,
      lines: v.lines,
      blocks: v.blocks,
      filePairs: v.filePairs.size,
    }))
    .sort((x, y) => y.lines - x.lines || (x.dirA < y.dirA ? -1 : 1));
}

/** Pure core — testable without the jscpd binary. */
export function buildDuplicationLane(
  jscpd: JscpdResult,
  candidateFiles: string[],
  codeLines: Map<string, number>,
  /** Source reader; without it spans are counted raw (comments included). */
  readSource: (path: string) => string | null = () => null,
): DuplicationLaneResult {
  if (!jscpd.available) {
    return {
      lane: "duplication",
      available: false,
      disclosure:
        "jscpd not available — duplication lane skipped (bundled with vibecheck; npx could not resolve it)",
      entries: [],
      dirPairs: [],
    };
  }

  const candidates = new Set(candidateFiles);
  const intervals = new Map<string, [number, number][]>();
  const partners = new Map<string, Set<string>>();
  const cloneRefs = new Map<string, CloneRef[]>();
  const add = (
    file: string,
    start: number,
    end: number,
    partner: string,
    partnerStart: number,
    partnerEnd: number,
  ) => {
    if (!candidates.has(file)) return;
    const list = intervals.get(file) ?? [];
    list.push([start, end]);
    intervals.set(file, list);
    const set = partners.get(file) ?? new Set<string>();
    if (partner !== file) set.add(partner);
    partners.set(file, set);
    const refs = cloneRefs.get(file) ?? [];
    refs.push({
      start,
      end,
      partner: partner === file ? "" : partner,
      partnerStart,
      partnerEnd,
    });
    cloneRefs.set(file, refs);
  };
  for (const clone of jscpd.clones) {
    add(clone.fileA, clone.startA, clone.endA, clone.fileB, clone.startB, clone.endB);
    add(clone.fileB, clone.startB, clone.endB, clone.fileA, clone.startA, clone.endA);
  }

  const entries: DuplicationLaneEntry[] = [];
  for (const [path, list] of intervals) {
    const source = readSource(path);
    const sourceLines = source === null ? null : source.split("\n");
    // Merge first so overlapping clones never double-count, then measure
    // the merged spans on scc's basis.
    const duplicatedLines =
      sourceLines === null
        ? mergedCoverage(list)
        : mergedIntervals(list).reduce(
            (sum, [a, b]) => sum + countCodeLinesInSpan(sourceLines, a, b),
            0,
          );
    const lines = codeLines.get(path) ?? 0;
    entries.push({
      path,
      duplicatedLines,
      codeLines: lines,
      clusterFanOut: partners.get(path)?.size ?? 0,
      clones: (cloneRefs.get(path) ?? [])
        .sort((a, b) => b.end - b.start - (a.end - a.start))
        .slice(0, 5),
      // Without scc the share is unknowable; keep the entry with score 0
      // rather than invent a denominator.
      score: lines > 0 ? Math.min(1, duplicatedLines / lines) : 0,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    lane: "duplication",
    available: true,
    entries,
    dirPairs: computeDirPairs(jscpd.clones, candidates),
  };
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
    (path) => {
      try {
        return readFileSync(join(rootPath, path), "utf-8");
      } catch {
        return null;
      }
    },
  );
}
