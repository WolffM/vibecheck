/**
 * L1 · Dead code lane (state-descriptive, alarm-only)
 *
 * knip (TS/JS) + vulture (Python). Density = share of a file's exported/
 * defined surface believed dead. Confidence rules per design §3.1-L1:
 *  - vulture is a single source (Skylos union is M2 backlog), so its
 *    scores carry a flat demotion, disclosed.
 *  - knip's whole-file claims auto-mute when it flags an implausible
 *    share of the repo's TS/JS files — that failure mode is entry-point
 *    detection breaking (spawned-not-imported entries), not a repo that
 *    is one-third dead.
 * State lane: validated by inspection and noise verdicts, never fitted
 * on outcomes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTsJsFile } from "../import-graph.js";
import { runKnip, type KnipResult } from "../runners/knip.js";
import { runVulture, type VultureResult } from "../runners/vulture.js";

/** Single-source (vulture-only) findings score at this fraction. */
export const SINGLE_SOURCE_DEMOTION = 0.6;
/** knip unused-file claims mute above this share of TS/JS candidates. */
export const KNIP_FILES_MUTE_SHARE = 0.3;
/** The implausibility mute needs a sample; below this many TS/JS files a
 * high dead share can simply be true. */
export const KNIP_FILES_MUTE_MIN_CANDIDATES = 10;

export interface DeadcodeLaneEntry {
  path: string;
  applicable: true;
  /** Whole file flagged unused (knip), unless the mute is active. */
  unusedFile: boolean;
  deadItems: number;
  definitionCount: number;
  score: number;
}

export interface DeadcodeLaneResult {
  lane: "deadcode";
  available: boolean;
  disclosures: string[];
  filesSignalMuted: boolean;
  /** Languages actually covered this run ("ts-js", "python"). */
  coverage: string[];
  entries: DeadcodeLaneEntry[];
}

function isPythonFile(path: string): boolean {
  return path.endsWith(".py");
}

/** Exported/defined surface per file — the share denominator. */
export function countDefinitions(
  rootPath: string,
  files: string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(join(rootPath, file), "utf-8");
    } catch {
      continue;
    }
    let pattern: RegExp;
    if (isTsJsFile(file)) {
      pattern = /^export\s|^module\.exports/gm;
    } else if (isPythonFile(file)) {
      pattern = /^\s*(async\s+)?def\s|^\s*class\s/gm;
    } else {
      continue;
    }
    counts.set(file, (source.match(pattern) ?? []).length);
  }
  return counts;
}

/** Pure core — testable without the binaries. */
export function buildDeadcodeLane(
  knip: KnipResult,
  vulture: VultureResult,
  candidateFiles: string[],
  definitions: Map<string, number>,
): DeadcodeLaneResult {
  const disclosures: string[] = [];
  const coverage: string[] = [];
  if (knip.available) coverage.push("ts-js");
  if (vulture.available) coverage.push("python");
  if (!knip.available && candidateFiles.some(isTsJsFile)) {
    disclosures.push("knip unavailable — TS/JS dead code not assessed");
  }
  if (!vulture.available && candidateFiles.some(isPythonFile)) {
    disclosures.push("vulture unavailable — Python dead code not assessed");
  }
  if (vulture.available) {
    disclosures.push(
      "Python findings are single-source (vulture without Skylos) — scores demoted",
    );
  }
  if (coverage.length === 0) {
    return {
      lane: "deadcode",
      available: false,
      disclosures:
        disclosures.length > 0
          ? disclosures
          : ["no dead-code tool available for this repo's languages"],
      filesSignalMuted: false,
      coverage,
      entries: [],
    };
  }

  const candidates = new Set(candidateFiles);
  const tsjsCandidates = candidateFiles.filter(isTsJsFile);
  const unusedFiles = new Set(
    knip.unusedFiles.filter((f) => candidates.has(f)),
  );
  const filesSignalMuted =
    tsjsCandidates.length >= KNIP_FILES_MUTE_MIN_CANDIDATES &&
    unusedFiles.size / tsjsCandidates.length > KNIP_FILES_MUTE_SHARE;
  if (filesSignalMuted) {
    disclosures.push(
      `knip flagged ${unusedFiles.size}/${tsjsCandidates.length} TS/JS files as unused — implausible share, whole-file signal muted (likely entry-point detection; add a knip.json)`,
    );
  }

  const vultureByFile = new Map<string, number>();
  for (const item of vulture.items) {
    if (!candidates.has(item.path)) continue;
    vultureByFile.set(item.path, (vultureByFile.get(item.path) ?? 0) + 1);
  }

  const entries: DeadcodeLaneEntry[] = [];
  for (const path of candidateFiles) {
    const tsjs = isTsJsFile(path);
    const python = isPythonFile(path);
    if (tsjs && !knip.available) continue;
    if (python && !vulture.available) continue;
    if (!tsjs && !python) continue;

    const defs = definitions.get(path) ?? 0;
    let score = 0;
    let unusedFile = false;
    let deadItems = 0;
    if (tsjs) {
      unusedFile = unusedFiles.has(path) && !filesSignalMuted;
      deadItems = knip.unusedExports.get(path) ?? 0;
      score = unusedFile
        ? 1
        : defs > 0
          ? Math.min(1, deadItems / defs)
          : 0;
    } else {
      deadItems = vultureByFile.get(path) ?? 0;
      score =
        defs > 0
          ? SINGLE_SOURCE_DEMOTION * Math.min(1, deadItems / defs)
          : 0;
    }

    entries.push({
      path,
      applicable: true,
      unusedFile,
      deadItems,
      definitionCount: defs,
      score,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    lane: "deadcode",
    available: true,
    disclosures,
    filesSignalMuted,
    coverage,
    entries,
  };
}

export function runDeadcodeLane(
  rootPath: string,
  candidateFiles: string[],
): DeadcodeLaneResult {
  const hasTsJs = candidateFiles.some(isTsJsFile);
  const hasPython = candidateFiles.some(isPythonFile);
  const knip = hasTsJs
    ? runKnip(rootPath)
    : { available: false, unusedFiles: [], unusedExports: new Map<string, number>() };
  const vulture = hasPython
    ? runVulture(rootPath)
    : { available: false, items: [] };
  return buildDeadcodeLane(
    knip,
    vulture,
    candidateFiles,
    countDefinitions(rootPath, candidateFiles),
  );
}
