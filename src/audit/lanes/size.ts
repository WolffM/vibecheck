/**
 * L5 · Size & complexity lane (outcome-predictive)
 *
 * scc code lines against language-adjusted tier boundaries. Emits per-file
 * densities (design §4: firing is decided later by anchors/floors in
 * scoring, not here). Cohesion modifier is stubbed neutral in M1.
 */

import type { ResolvedAuditConfig } from "../config.js";
import { runScc, type SccResult } from "../runners/scc.js";

/**
 * Hand-set language multipliers scaling tier boundaries (behavioral
 * constants, §10.1 taxonomy: declared now, field-revisited with M1 data).
 * >1 = verbose language, boundaries loosen; <1 = terse, boundaries tighten.
 */
export const SIZE_LANGUAGE_MULTIPLIERS: Record<string, number> = {
  Java: 1.3,
  "C#": 1.3,
  "C++": 1.2,
  Go: 1.2,
  Python: 0.8,
  Ruby: 0.8,
};

export function sizeMultiplier(language: string): number {
  return SIZE_LANGUAGE_MULTIPLIERS[language] ?? 1.0;
}

export type SizeTier = 0 | 1 | 2 | 3;

export interface SizeLaneEntry {
  path: string;
  language: string;
  codeLines: number;
  complexity: number;
  tier: SizeTier;
  /**
   * Lane density: codeLines / (tier-1 boundary × language multiplier).
   * 1.0 sits exactly on the tier-1 boundary; anchors in scoring consume
   * this scale.
   */
  score: number;
  /** Neutral in M1; real cohesion analysis is an M2 item. */
  cohesionModifier: 1;
}

export interface SizeLaneResult {
  lane: "size";
  available: boolean;
  toolVersion: string | null;
  /** Present when the lane could not run or ran degraded. */
  disclosure?: string;
  entries: SizeLaneEntry[];
}

function assignTier(
  codeLines: number,
  multiplier: number,
  tiers: [number, number, number],
): SizeTier {
  if (codeLines >= tiers[2] * multiplier) return 3;
  if (codeLines >= tiers[1] * multiplier) return 2;
  if (codeLines >= tiers[0] * multiplier) return 1;
  return 0;
}

/** Pure core — testable without the scc binary. */
export function buildSizeLane(
  scc: SccResult,
  candidateFiles: string[],
  config: ResolvedAuditConfig,
): SizeLaneResult {
  if (!scc.available) {
    return {
      lane: "size",
      available: false,
      toolVersion: scc.version,
      disclosure:
        "scc not available — size lane skipped; install scc (https://github.com/boyter/scc) to enable it",
      entries: [],
    };
  }

  const candidates = new Set(candidateFiles);
  const tiers = config.sizeTiers;
  const entries: SizeLaneEntry[] = scc.files
    .filter((f) => candidates.has(f.path))
    .map((f) => {
      const multiplier = sizeMultiplier(f.language);
      return {
        path: f.path,
        language: f.language,
        codeLines: f.codeLines,
        complexity: f.complexity,
        tier: assignTier(f.codeLines, multiplier, tiers),
        score: f.codeLines / (tiers[0] * multiplier),
        cohesionModifier: 1 as const,
      };
    });

  return {
    lane: "size",
    available: true,
    toolVersion: scc.version,
    entries,
  };
}

export function runSizeLane(
  rootPath: string,
  candidateFiles: string[],
  config: ResolvedAuditConfig,
): SizeLaneResult {
  return buildSizeLane(runScc(rootPath), candidateFiles, config);
}
