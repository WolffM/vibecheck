import { describe, expect, it } from "vitest";
import { buildDuplicationLane } from "../src/audit/lanes/duplication.js";
import type { JscpdResult } from "../src/audit/runners/jscpd.js";

function clones(pairs: JscpdResult["clones"]): JscpdResult {
  return { available: true, clones: pairs };
}

describe("buildDuplicationLane", () => {
  const codeLines = new Map([
    ["src/a.ts", 100],
    ["src/b.ts", 200],
    ["src/c.ts", 50],
  ]);

  it("computes duplicated share per file from clone pairs", () => {
    const result = buildDuplicationLane(
      clones([
        {
          fileA: "src/a.ts",
          startA: 1,
          endA: 30,
          fileB: "src/b.ts",
          startB: 51,
          endB: 80,
          lines: 30,
        },
      ]),
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      codeLines,
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("src/a.ts")?.duplicatedLines).toBe(30);
    expect(byPath.get("src/a.ts")?.score).toBeCloseTo(0.3);
    expect(byPath.get("src/b.ts")?.score).toBeCloseTo(0.15);
    expect(byPath.get("src/a.ts")?.clusterFanOut).toBe(1);
    // Untouched files carry no entry.
    expect(byPath.has("src/c.ts")).toBe(false);
  });

  it("merges overlapping clone intervals instead of double-counting", () => {
    const result = buildDuplicationLane(
      clones([
        {
          fileA: "src/a.ts",
          startA: 1,
          endA: 40,
          fileB: "src/b.ts",
          startB: 1,
          endB: 40,
          lines: 40,
        },
        {
          fileA: "src/a.ts",
          startA: 20,
          endA: 60,
          fileB: "src/c.ts",
          startB: 1,
          endB: 41,
          lines: 41,
        },
      ]),
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      codeLines,
    );
    const a = result.entries.find((e) => e.path === "src/a.ts");
    // 1-40 ∪ 20-60 = 1-60, not 81.
    expect(a?.duplicatedLines).toBe(60);
    expect(a?.clusterFanOut).toBe(2);
  });

  it("keeps entries for files without scc lines at score 0 (no invented denominator)", () => {
    const result = buildDuplicationLane(
      clones([
        {
          fileA: "src/unknown.ts",
          startA: 1,
          endA: 30,
          fileB: "src/a.ts",
          startB: 1,
          endB: 30,
          lines: 30,
        },
      ]),
      ["src/unknown.ts", "src/a.ts"],
      codeLines,
    );
    const unknown = result.entries.find((e) => e.path === "src/unknown.ts");
    expect(unknown?.score).toBe(0);
    expect(unknown?.duplicatedLines).toBe(30);
  });

  it("respects the candidate set (excluded files never enter)", () => {
    const result = buildDuplicationLane(
      clones([
        {
          fileA: "dist/bundle.js",
          startA: 1,
          endA: 30,
          fileB: "src/a.ts",
          startB: 1,
          endB: 30,
          lines: 30,
        },
      ]),
      ["src/a.ts"],
      codeLines,
    );
    expect(result.entries.map((e) => e.path)).toEqual(["src/a.ts"]);
  });

  it("degrades with disclosure when jscpd is unavailable", () => {
    const result = buildDuplicationLane(
      { available: false, clones: [] },
      ["src/a.ts"],
      codeLines,
    );
    expect(result.available).toBe(false);
    expect(result.disclosure).toMatch(/jscpd not available/);
  });
});
