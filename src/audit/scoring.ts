/**
 * Scoring, firing, and the corroboration gate (design §4)
 *
 * Lane scores are densities; this module owns what fires and what ranks:
 *   firing    = score ≥ max(hand-set anchor, attested per-repo floor)
 *   the gate  = nothing enters worst offenders without ≥2 applicable
 *               lanes firing (coverage-aware: applicable count recorded)
 *   ranking   = weighted sum of firing lanes' anchor-normalized scores
 *
 * Anchors own firing (hand-set globally, bent per-repo only by the
 * ratchet). The backtest owns ordering. Neither touches the other's job.
 */

/**
 * Hand-set absolute anchors, on each lane's own density scale (§10.1
 * threshold constants — anchor perturbation checks ordering robustness
 * at T11):
 *  - size: 1.0 = the language-adjusted tier-1 boundary (500 code lines
 *    unadjusted).
 *  - arrival: 1.0 = every single windowed touch arrived with no reaching
 *    test. Initially 0.6, which assumed partial test co-change; M1
 *    dogfood across four repos (docs/audit-m1-notes.md) showed the
 *    vibecoded segment saturates untested-share ≈ 1 (firing on 85–100%
 *    of applicable files — corroborating nothing), so the anchor moved
 *    to the one crisp point the distribution has. Refined from
 *    pre-ratchet firing data only, per §4's calibration-authority rule.
 *  - deadcode: 0.5 = half the exported/defined surface believed dead
 *    (whole-file knip claims score 1.0 and clear it trivially).
 *  - duplication: 0.3 = 30% of the file's code lines duplicated
 *    elsewhere.
 *  - smells: 0.5 = one `any` per twenty code lines; low-weighted.
 *  - consistency: 0.7 = copy artifacts (1.0), orphans (0.8), and
 *    minority-provider sites (0.7) fire; cycles (0.5) corroborate only.
 */
export const LANE_ANCHORS: Record<string, number> = {
  size: 1.0,
  arrival: 1.0,
  deadcode: 0.5,
  duplication: 0.3,
  smells: 0.5,
  consistency: 0.7,
};

/** Hand-set lane weights applied to anchor-normalized scores. */
export const LANE_WEIGHTS: Record<string, number> = {
  size: 1.0,
  arrival: 1.0,
  deadcode: 1.0,
  duplication: 1.0,
  smells: 0.5,
  consistency: 1.0,
};

/**
 * Minimum weighted score to enter the report at all (before the item
 * cap). Both lanes exactly at anchor sum to 2.0; entry demands margin.
 */
export const ENTRY_THRESHOLD = 2.2;

/** Each importer counts as this many code lines of blast radius. */
const FAN_IN_LINE_EQUIVALENT = 100;

export interface LaneScore {
  lane: string;
  path: string;
  score: number;
  /** False = the lane abstains for this file (thin history, no coverage). */
  applicable: boolean;
}

export interface FiringLane {
  lane: string;
  score: number;
  /** The threshold that was actually applied: max(anchor, floor). */
  threshold: number;
}

export interface FileScore {
  path: string;
  applicableLanes: string[];
  firingLanes: FiringLane[];
  /** Lanes at/above anchor but below a ratcheted floor (§5 disposition). */
  suppressedByFloor: string[];
  /** Σ weight × (score ÷ anchor) over firing lanes. */
  weightedScore: number;
  /** ≥2 applicable lanes firing. */
  gatePassed: boolean;
}

/**
 * Repo-saturation mute (v0.3, generalized from bulk arrival's variance
 * collapse): a lane firing on most of a repo's applicable files carries
 * a repo-level fact, not per-file information — as corroboration it
 * contributes a constant, silently degrading the ≥2-lane gate to a
 * ≥1-other-lane gate. Round 1 measured arrival at 75–100% firing on
 * every partner repo, so the threshold sits below the observed
 * non-discriminating band. Saturated lanes convert to a health-summary
 * headline and stop counting toward the gate until they discriminate.
 */
export const SATURATION_FIRING_RATE = 0.7;
export const SATURATION_MIN_APPLICABLE = 20;

/** lane → firing rate, for lanes past the saturation threshold. */
export function detectSaturatedLanes(
  laneScores: LaneScore[],
  floors: Record<string, number> = {},
): Map<string, number> {
  const perLane = new Map<string, { applicable: number; firing: number }>();
  for (const s of laneScores) {
    if (!s.applicable) continue;
    const anchor = LANE_ANCHORS[s.lane];
    if (anchor === undefined) continue;
    const stats = perLane.get(s.lane) ?? { applicable: 0, firing: 0 };
    stats.applicable++;
    if (s.score >= Math.max(anchor, floors[s.lane] ?? 0)) stats.firing++;
    perLane.set(s.lane, stats);
  }
  const saturated = new Map<string, number>();
  for (const [lane, stats] of perLane) {
    if (
      stats.applicable >= SATURATION_MIN_APPLICABLE &&
      stats.firing / stats.applicable >= SATURATION_FIRING_RATE
    ) {
      saturated.set(lane, stats.firing / stats.applicable);
    }
  }
  return saturated;
}

export interface ScoringOptions {
  /** Per-lane attested floors (ratchet); absent lanes floor at 0. */
  floors?: Record<string, number>;
  /** Anchor overrides — used only by the perturbation check (§10.1). */
  anchors?: Record<string, number>;
}

export function scoreFiles(
  laneScores: LaneScore[],
  options: ScoringOptions = {},
): FileScore[] {
  const floors = options.floors ?? {};
  const anchors = { ...LANE_ANCHORS, ...options.anchors };
  const byPath = new Map<string, LaneScore[]>();
  for (const score of laneScores) {
    const list = byPath.get(score.path) ?? [];
    list.push(score);
    byPath.set(score.path, list);
  }

  const results: FileScore[] = [];
  for (const [path, scores] of byPath) {
    const applicable = scores.filter((s) => s.applicable);
    const firingLanes: FiringLane[] = [];
    const suppressedByFloor: string[] = [];
    let weightedScore = 0;

    for (const s of applicable) {
      const anchor = anchors[s.lane];
      if (anchor === undefined) continue;
      const floor = floors[s.lane] ?? 0;
      const threshold = Math.max(anchor, floor);
      if (s.score >= threshold) {
        firingLanes.push({ lane: s.lane, score: s.score, threshold });
        weightedScore += (LANE_WEIGHTS[s.lane] ?? 1) * (s.score / anchor);
      } else if (s.score >= anchor) {
        suppressedByFloor.push(s.lane);
      }
    }

    firingLanes.sort((a, b) => (a.lane < b.lane ? -1 : 1));
    results.push({
      path,
      applicableLanes: applicable.map((s) => s.lane).sort(),
      firingLanes,
      suppressedByFloor: suppressedByFloor.sort(),
      weightedScore,
      gatePassed: firingLanes.length >= 2,
    });
  }

  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results;
}

/**
 * Gate-passing files above the entry threshold, worst first. `maxItems`
 * is a ceiling, never the selector — the threshold decides entry.
 */
export function worstOffenders(
  fileScores: FileScore[],
  maxItems: number,
): FileScore[] {
  return fileScores
    .filter((f) => f.gatePassed && f.weightedScore >= ENTRY_THRESHOLD)
    .sort(
      (a, b) =>
        b.weightedScore - a.weightedScore ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .slice(0, maxItems);
}

/**
 * Blast radius = code lines + fan-in, with each importer valued at
 * FAN_IN_LINE_EQUIVALENT lines (hand-set composite).
 */
export function computeBlastRadius(
  codeLines: Map<string, number>,
  importGraph: Map<string, string[]>,
): Map<string, number> {
  const fanIn = new Map<string, number>();
  for (const targets of importGraph.values()) {
    for (const target of targets) {
      fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
    }
  }
  const blast = new Map<string, number>();
  const paths = new Set([...codeLines.keys(), ...fanIn.keys()]);
  for (const path of paths) {
    blast.set(
      path,
      (codeLines.get(path) ?? 0) +
        FAN_IN_LINE_EQUIVALENT * (fanIn.get(path) ?? 0),
    );
  }
  return blast;
}

/**
 * Best first targets (§4.4): entrants with the *lowest* blast radius —
 * real problems a maintainer can safely start on.
 */
export function bestFirstTargets(
  fileScores: FileScore[],
  blastRadius: Map<string, number>,
  maxItems = 5,
): FileScore[] {
  return fileScores
    .filter((f) => f.gatePassed && f.weightedScore >= ENTRY_THRESHOLD)
    .sort((a, b) => {
      const blastA = blastRadius.get(a.path) ?? Number.MAX_SAFE_INTEGER;
      const blastB = blastRadius.get(b.path) ?? Number.MAX_SAFE_INTEGER;
      return (
        blastA - blastB ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      );
    })
    .slice(0, maxItems);
}
