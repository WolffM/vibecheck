import { describe, expect, it } from "vitest";
import {
  computeGroupLift,
  labelOutcomes,
  type FileOutcome,
} from "../src/audit/backtest.js";
import type { CommitRecord } from "../src/audit/git-arrival.js";

function commit(
  date: string,
  files: { path: string; added: number }[],
): CommitRecord {
  return {
    sha: "c".repeat(40),
    date,
    isMerge: false,
    subject: "post-epoch work",
    files: files.map((f) => ({ ...f, deleted: 0, binary: false })),
    testFiles: [],
  };
}

describe("labelOutcomes", () => {
  const headTracked = new Set(["src/kept.ts", "src/patched.ts", "src/renamed-new.ts"]);

  it("labels deleted, rewritten, heavily patched, and quiet", () => {
    const epochFiles = new Map([
      ["src/kept.ts", 200],
      ["src/gone.ts", 150],
      ["src/patched.ts", 300],
    ]);
    const commits = [
      // patched: five small touches, adds far below the rewrite share
      ...Array.from({ length: 5 }, (_, i) =>
        commit(`2026-0${(i % 5) + 1}-15T00:00:00Z`, [
          { path: "src/patched.ts", added: 3 },
        ]),
      ),
      // kept: one big post-epoch dump ≥ 50% of its 200 epoch lines
      commit("2026-06-01T00:00:00Z", [{ path: "src/kept.ts", added: 120 }]),
    ];
    const outcomes = labelOutcomes(epochFiles, commits, headTracked, new Map());
    expect(outcomes.get("src/gone.ts")?.outcome).toBe("deleted");
    expect(outcomes.get("src/kept.ts")?.outcome).toBe("rewritten");
    expect(outcomes.get("src/patched.ts")?.outcome).toBe("heavily-patched");
  });

  it("tautology guard: pre-epoch activity never colors the label", () => {
    // The harness passes post-epoch commits only; a file whose entire
    // history predates the epoch must label quiet, however hot it was.
    const outcomes = labelOutcomes(
      new Map([["src/kept.ts", 500]]),
      [],
      headTracked,
      new Map(),
    );
    expect(outcomes.get("src/kept.ts")?.outcome).toBe("quiet");
    expect(outcomes.get("src/kept.ts")?.touchesInWindow).toBe(0);
  });

  it("follows renames instead of calling a moved file deleted", () => {
    const outcomes = labelOutcomes(
      new Map([["src/renamed-old.ts", 100]]),
      [commit("2026-06-01T00:00:00Z", [{ path: "src/renamed-new.ts", added: 10 }])],
      headTracked,
      new Map([["src/renamed-old.ts", "src/renamed-new.ts"]]),
    );
    const outcome = outcomes.get("src/renamed-old.ts");
    expect(outcome?.outcome).toBe("quiet");
    expect(outcome?.addedInWindow).toBe(10);
  });

  it("rewrite threshold sits exactly at the 50% share", () => {
    const at = (added: number) =>
      labelOutcomes(
        new Map([["src/kept.ts", 200]]),
        [commit("2026-06-01T00:00:00Z", [{ path: "src/kept.ts", added }])],
        headTracked,
        new Map(),
      ).get("src/kept.ts")?.outcome;
    expect(at(100)).toBe("rewritten");
    expect(at(99)).toBe("quiet");
  });
});

describe("computeGroupLift", () => {
  function outcome(
    path: string,
    kind: FileOutcome["outcome"],
    size: number,
  ): [string, FileOutcome] {
    return [
      path,
      {
        path,
        outcome: kind,
        epochCodeLines: size,
        addedInWindow: 0,
        touchesInWindow: 0,
      },
    ];
  }

  it("matches controls by size and reports rates plus lift", () => {
    const outcomes = new Map([
      outcome("hot1.ts", "rewritten", 600),
      outcome("hot2.ts", "deleted", 800),
      outcome("cold-big.ts", "quiet", 620),
      outcome("cold-big2.ts", "rewritten", 790),
      outcome("cold-small.ts", "quiet", 50),
    ]);
    const lift = computeGroupLift(
      "test group",
      ["hot1.ts", "hot2.ts"],
      ["cold-big.ts", "cold-big2.ts", "cold-small.ts"],
      outcomes,
    );
    expect(lift.files).toBe(2);
    expect(lift.correctiveRate).toBe(1);
    expect(lift.controls).toBe(2);
    // Size matching picks the two big controls, one of which is corrective.
    expect(lift.controlRate).toBe(0.5);
    expect(lift.lift).toBe(2);
  });

  it("returns null lift when no controls exist", () => {
    const outcomes = new Map([outcome("hot.ts", "deleted", 100)]);
    const lift = computeGroupLift("empty", ["hot.ts"], [], outcomes);
    expect(lift.lift).toBeNull();
  });
});
