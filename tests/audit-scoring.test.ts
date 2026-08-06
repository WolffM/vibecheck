import { describe, expect, it } from "vitest";
import {
  bestFirstTargets,
  computeBlastRadius,
  scoreFiles,
  worstOffenders,
  type LaneScore,
} from "../src/audit/scoring.js";

function lane(
  laneName: string,
  path: string,
  score: number,
  applicable = true,
): LaneScore {
  return { lane: laneName, path, score, applicable };
}

describe("scoreFiles + gate", () => {
  it("a single-lane extreme never enters worst offenders", () => {
    const scores = scoreFiles([
      // 9000-line monster, but arrival is quiet.
      lane("size", "monster.ts", 18),
      lane("arrival", "monster.ts", 0.1),
    ]);
    expect(scores[0].gatePassed).toBe(false);
    expect(scores[0].firingLanes.map((f) => f.lane)).toEqual(["size"]);
    expect(worstOffenders(scores, 15)).toEqual([]);
  });

  it("two moderately-firing lanes enter while one loud lane does not", () => {
    const scores = scoreFiles([
      lane("size", "corroborated.ts", 1.4),
      lane("arrival", "corroborated.ts", 1.05),
      lane("size", "loud-single.ts", 20),
      lane("arrival", "loud-single.ts", 0.2),
    ]);
    const offenders = worstOffenders(scores, 15);
    expect(offenders.map((o) => o.path)).toEqual(["corroborated.ts"]);
  });

  it("records applicable-lane counts for thin-coverage files", () => {
    const scores = scoreFiles([
      lane("size", "thin.ts", 2.0),
      lane("arrival", "thin.ts", 0.9, false),
    ]);
    expect(scores[0].applicableLanes).toEqual(["size"]);
    expect(scores[0].gatePassed).toBe(false);
  });

  it("applies max(anchor, floor) and records suppressed-by-floor", () => {
    const scores = scoreFiles(
      [
        lane("arrival", "a.ts", 1.1),
        lane("size", "a.ts", 1.5),
      ],
      { floors: { arrival: 1.25 } },
    );
    const [a] = scores;
    expect(a.firingLanes.map((f) => f.lane)).toEqual(["size"]);
    expect(a.suppressedByFloor).toEqual(["arrival"]);
    expect(a.gatePassed).toBe(false);

    const above = scoreFiles(
      [lane("arrival", "b.ts", 1.3), lane("size", "b.ts", 1.5)],
      { floors: { arrival: 1.25 } },
    );
    expect(above[0].firingLanes.map((f) => f.lane)).toEqual([
      "arrival",
      "size",
    ]);
    expect(above[0].firingLanes.find((f) => f.lane === "arrival")?.threshold).toBe(
      1.25,
    );
  });

  it("ranks by anchor-normalized weighted sum, worst first", () => {
    const scores = scoreFiles([
      lane("size", "worse.ts", 4),
      lane("arrival", "worse.ts", 1.2),
      lane("size", "bad.ts", 1.2),
      lane("arrival", "bad.ts", 1.05),
    ]);
    const offenders = worstOffenders(scores, 15);
    expect(offenders.map((o) => o.path)).toEqual(["worse.ts", "bad.ts"]);
    // worse.ts: 4/1.0 + 1.2/1.0 = 5.2
    expect(offenders[0].weightedScore).toBeCloseTo(5.2);
  });

  it("entry threshold keeps barely-at-anchor files out even when gated", () => {
    const scores = scoreFiles([
      lane("size", "meh.ts", 1.0),
      lane("arrival", "meh.ts", 1.0),
    ]);
    expect(scores[0].gatePassed).toBe(true);
    expect(scores[0].weightedScore).toBeCloseTo(2.0);
    expect(worstOffenders(scores, 15)).toEqual([]);
  });

  it("maxItems is a ceiling, not a selector", () => {
    const scores = scoreFiles(
      Array.from({ length: 20 }, (_, i) => [
        lane("size", `f${String(i).padStart(2, "0")}.ts`, 3 + i * 0.1),
        lane("arrival", `f${String(i).padStart(2, "0")}.ts`, 1.05),
      ]).flat(),
    );
    expect(worstOffenders(scores, 15)).toHaveLength(15);
    expect(worstOffenders(scores, 3)).toHaveLength(3);
  });
});

describe("blast radius + best first targets", () => {
  it("computes codeLines + weighted fan-in", () => {
    const blast = computeBlastRadius(
      new Map([
        ["core.ts", 300],
        ["leaf.ts", 400],
      ]),
      new Map([
        ["a.ts", ["core.ts"]],
        ["b.ts", ["core.ts"]],
        ["core.ts", []],
        ["leaf.ts", []],
      ]),
    );
    expect(blast.get("core.ts")).toBe(500);
    expect(blast.get("leaf.ts")).toBe(400);
  });

  it("targets the lowest-blast entrant first", () => {
    const scores = scoreFiles([
      lane("size", "hub.ts", 3),
      lane("arrival", "hub.ts", 1.05),
      lane("size", "leaf.ts", 3),
      lane("arrival", "leaf.ts", 1.05),
    ]);
    const blast = new Map([
      ["hub.ts", 5000],
      ["leaf.ts", 600],
    ]);
    const targets = bestFirstTargets(scores, blast);
    expect(targets.map((t) => t.path)).toEqual(["leaf.ts", "hub.ts"]);
    // Non-entrants never appear regardless of blast radius.
    const single = scoreFiles([lane("size", "big-only.ts", 10)]);
    expect(bestFirstTargets(single, new Map([["big-only.ts", 10]]))).toEqual(
      [],
    );
  });
});
