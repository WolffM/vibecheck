import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  appendTrendEntry,
  computeDerivative,
  readTrends,
  selectBaseline,
  type TrendEntry,
} from "../src/audit/trends.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<TrendEntry> & { at: string }): TrendEntry {
  return {
    sha: `sha-${overrides.at}`,
    dirty: false,
    toolVersions: { scc: "3.7.0" },
    floors: {},
    aggregates: {
      candidateFiles: 100,
      perLane: {
        size: { filesAssessed: 90, filesFlagged: 4 },
        arrival: { filesAssessed: 40, filesFlagged: 6 },
      },
      gatePassing: 3,
      offenders: 3,
      suppressedByFloor: 0,
      ...(overrides.aggregates ?? {}),
    },
    ...overrides,
  };
}

describe("selectBaseline", () => {
  const current = entry({ at: "2026-08-05T12:00:00Z" });

  it("picks the latest clean entry at least 21 days old", () => {
    const old = entry({ at: "2026-06-01T12:00:00Z" });
    const eligible = entry({ at: "2026-07-10T12:00:00Z" });
    const tooRecent = entry({ at: "2026-07-30T12:00:00Z" });
    expect(selectBaseline([old, eligible, tooRecent, current], current)).toBe(
      eligible,
    );
  });

  it("skips dirty entries", () => {
    const dirtyOld = entry({ at: "2026-07-10T12:00:00Z", dirty: true });
    const cleanOlder = entry({ at: "2026-06-20T12:00:00Z" });
    expect(selectBaseline([cleanOlder, dirtyOld, current], current)).toBe(
      cleanOlder,
    );
  });

  it("returns null when nothing qualifies", () => {
    const tooRecent = entry({ at: "2026-08-01T12:00:00Z" });
    expect(selectBaseline([tooRecent, current], current)).toBeNull();
    expect(selectBaseline([current], current)).toBeNull();
  });
});

describe("computeDerivative", () => {
  const baseline = entry({ at: "2026-07-01T12:00:00Z" });

  it("computes offender and per-lane firing deltas over the span", () => {
    const current = entry({
      at: "2026-08-05T12:00:00Z",
      aggregates: {
        candidateFiles: 110,
        perLane: {
          size: { filesAssessed: 95, filesFlagged: 6 },
          arrival: { filesAssessed: 42, filesFlagged: 5 },
        },
        gatePassing: 5,
        offenders: 5,
        suppressedByFloor: 0,
      },
    });
    const derivative = computeDerivative([baseline, current], current);
    expect(derivative).not.toBeNull();
    expect(derivative?.spanDays).toBe(35);
    expect(derivative?.offendersDelta).toBe(2);
    expect(derivative?.firingDelta).toEqual({ size: 2, arrival: -1 });
    expect(derivative?.trendBreaks).toEqual([]);
  });

  it("flags floor changes as trend breaks instead of absorbing them", () => {
    const current = entry({
      at: "2026-08-05T12:00:00Z",
      floors: { arrival: 0.75 },
    });
    const derivative = computeDerivative([baseline, current], current);
    expect(derivative?.trendBreaks).toContain("floor: arrival 0 → 0.75");
  });

  it("flags tool upgrades as trend breaks", () => {
    const current = entry({
      at: "2026-08-05T12:00:00Z",
      toolVersions: { scc: "3.8.0" },
    });
    expect(computeDerivative([baseline, current], current)?.trendBreaks).toContain(
      "tool-version: scc 3.7.0 → 3.8.0",
    );
  });

  it("never counts floor suppression as improvement", () => {
    // Offenders dropped 3 → 1, but 2 findings are hidden behind a floor.
    const current = entry({
      at: "2026-08-05T12:00:00Z",
      floors: { arrival: 0.75 },
      aggregates: {
        candidateFiles: 100,
        perLane: {
          size: { filesAssessed: 90, filesFlagged: 4 },
          arrival: { filesAssessed: 40, filesFlagged: 2 },
        },
        gatePassing: 1,
        offenders: 1,
        suppressedByFloor: 2,
      },
    });
    const derivative = computeDerivative([baseline, current], current);
    expect(derivative?.suppressedByFloorExcluded).toBe(2);
    // Raw delta -2, discounted back to 0: no claimed improvement.
    expect(derivative?.offendersDelta).toBe(0);
  });

  it("returns null with no eligible baseline", () => {
    const current = entry({ at: "2026-08-05T12:00:00Z" });
    expect(computeDerivative([current], current)).toBeNull();
  });
});

describe("appendTrendEntry", () => {
  it("appends new entries and replaces same-SHA reruns", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecheck-trends-"));
    cleanups.push(root);

    const first = entry({ at: "2026-07-01T12:00:00Z", sha: "aaa" });
    appendTrendEntry(root, first);
    const rerun = entry({
      at: "2026-07-01T12:00:00Z",
      sha: "aaa",
      aggregates: {
        candidateFiles: 101,
        perLane: {},
        gatePassing: 0,
        offenders: 0,
        suppressedByFloor: 0,
      },
    });
    appendTrendEntry(root, rerun);
    expect(readTrends(root)).toHaveLength(1);
    expect(readTrends(root)[0].aggregates.candidateFiles).toBe(101);

    appendTrendEntry(root, entry({ at: "2026-07-08T12:00:00Z", sha: "bbb" }));
    expect(readTrends(root)).toHaveLength(2);
  });
});
