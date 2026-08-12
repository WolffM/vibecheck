/**
 * L6 · Structural smells lane (state-descriptive, low-weighted)
 *
 * First signal: type-coverage `any`-density for TypeScript files. The
 * ast-grep rulepack and cross-file joins remain M2 backlog, disclosed.
 * Per design the lane is low-weighted — smells corroborate, they do not
 * headline.
 */

import { runTypeCoverage, type TypeCoverageResult } from "../runners/type-coverage.js";

/**
 * Density scale (hand-set, §10.1 threshold constant): one `any` per ten
 * code lines scores 1.0.
 */
export const ANY_DENSITY_SCALE = 10;

const TS_EXTENSIONS = /\.(ts|tsx|mts|cts)$/;

export interface SmellsLaneEntry {
  path: string;
  applicable: true;
  anyCount: number;
  codeLines: number;
  score: number;
}

export interface SmellsLaneResult {
  lane: "smells";
  available: boolean;
  disclosures: string[];
  typedPercent: number | null;
  entries: SmellsLaneEntry[];
}

/** Pure core — testable without the binary. */
export function buildSmellsLane(
  typeCoverage: TypeCoverageResult,
  candidateFiles: string[],
  codeLines: Map<string, number>,
): SmellsLaneResult {
  const disclosures = [
    "smells lane currently carries type-coverage only; the ast-grep rulepack is M2 backlog",
  ];
  if (!typeCoverage.available) {
    return {
      lane: "smells",
      available: false,
      disclosures: [
        "type-coverage unavailable (no tsconfig.json at any JS project root, or typescript not resolvable) — smells lane skipped",
      ],
      typedPercent: null,
      entries: [],
    };
  }

  const entries: SmellsLaneEntry[] = [];
  for (const path of candidateFiles) {
    if (!TS_EXTENSIONS.test(path) || path.endsWith(".d.ts")) continue;
    const anyCount = typeCoverage.anyCounts.get(path) ?? 0;
    const lines = codeLines.get(path) ?? 0;
    entries.push({
      path,
      applicable: true,
      anyCount,
      codeLines: lines,
      score:
        lines > 0 ? Math.min(1.5, (anyCount / lines) * ANY_DENSITY_SCALE) : 0,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    lane: "smells",
    available: true,
    disclosures,
    typedPercent: typeCoverage.percent,
    entries,
  };
}

export function runSmellsLane(
  rootPath: string,
  candidateFiles: string[],
  codeLines: Map<string, number>,
  jsRoots: string[] = ["."],
): SmellsLaneResult {
  return buildSmellsLane(
    runTypeCoverage(rootPath, jsRoots),
    candidateFiles,
    codeLines,
  );
}
