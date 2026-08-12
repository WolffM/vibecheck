/**
 * L5 · Size & complexity lane (outcome-predictive)
 *
 * scc code lines against language-adjusted tier boundaries. Emits per-file
 * densities (design §4: firing is decided later by anchors/floors in
 * scoring, not here). Cohesion modifier is stubbed neutral in M1.
 */

import type { ResolvedAuditConfig } from "../config.js";
import { countDocstringLines } from "../runners/py-docstrings.js";
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

/**
 * Data/markup languages scc measures but the size lane must not tier —
 * a 3000-line JSON blueprint is data, not a maintainability offender
 * (M1 dogfood: blueprint JSON dominated a repo's offender list).
 */
const DATA_LANGUAGES = new Set([
  "JSON",
  "YAML",
  "TOML",
  "XML",
  "Markdown",
  "HTML",
  "SVG",
  "CSV",
  "INI",
  "Plain Text",
  "Text",
  "gitignore",
  "License",
  "Properties File",
  "Jupyter",
]);

export function isDataLanguage(language: string): boolean {
  return DATA_LANGUAGES.has(language);
}

export type SizeTier = 0 | 1 | 2 | 3;

export interface SizeLaneEntry {
  path: string;
  language: string;
  /** Logic lines: scc code lines, minus docstring extents for Python. */
  codeLines: number;
  /**
   * Unadjusted scc code count, present only where an adjustment landed.
   * scc counts Python docstrings — and blank lines inside them — as
   * code, which penalizes exactly the documentation a repo may require.
   */
  rawCodeLines?: number;
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
  /** Measurement notes for an available lane (e.g. docstring handling). */
  notes: string[];
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
  /** Docstring extents per Python file; null = python3 unavailable. */
  docstringLines: Map<string, number> | null = new Map(),
): SizeLaneResult {
  if (!scc.available) {
    return {
      lane: "size",
      available: false,
      toolVersion: scc.version,
      disclosure:
        "scc not available — size lane skipped; install scc (https://github.com/boyter/scc) to enable it",
      notes: [],
      entries: [],
    };
  }

  const candidates = new Set(candidateFiles);
  const tiers = config.sizeTiers;
  let adjustedCount = 0;
  const entries: SizeLaneEntry[] = scc.files
    .filter((f) => candidates.has(f.path) && !isDataLanguage(f.language))
    .map((f) => {
      const multiplier = sizeMultiplier(f.language);
      // scc counts Python docstrings as code (only `#` is a comment to
      // it); tier on the logic count so documentation is never the
      // offense (pygmalion beta finding 4).
      const docstrings = docstringLines?.get(f.path) ?? 0;
      const codeLines =
        docstrings > 0 ? Math.max(0, f.codeLines - docstrings) : f.codeLines;
      if (docstrings > 0) adjustedCount++;
      return {
        path: f.path,
        language: f.language,
        codeLines,
        ...(docstrings > 0 ? { rawCodeLines: f.codeLines } : {}),
        complexity: f.complexity,
        tier: assignTier(codeLines, multiplier, tiers),
        score: codeLines / (tiers[0] * multiplier),
        cohesionModifier: 1 as const,
      };
    });

  const hasPython = entries.some((e) => e.language === "Python");
  const notes: string[] = [];
  if (docstringLines === null && hasPython) {
    notes.push(
      "python3 unavailable — Python counts include docstrings (scc counts them as code); tiers may overstate",
    );
  } else if (adjustedCount > 0) {
    notes.push(
      `Python code lines exclude docstrings (ast-exact, ${adjustedCount} file${adjustedCount === 1 ? "" : "s"} adjusted); raw scc counts in machine data`,
    );
  }

  return {
    lane: "size",
    available: true,
    toolVersion: scc.version,
    notes,
    entries,
  };
}

export function runSizeLane(
  rootPath: string,
  candidateFiles: string[],
  config: ResolvedAuditConfig,
): SizeLaneResult {
  const pyFiles = candidateFiles.filter((f) => f.endsWith(".py"));
  return buildSizeLane(
    runScc(rootPath),
    candidateFiles,
    config,
    countDocstringLines(rootPath, pyFiles),
  );
}
