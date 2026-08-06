import { describe, expect, it } from "vitest";
import { buildSmellsLane } from "../src/audit/lanes/smells.js";
import type { TypeCoverageResult } from "../src/audit/runners/type-coverage.js";

function coverage(counts: Record<string, number>): TypeCoverageResult {
  return {
    available: true,
    anyCounts: new Map(Object.entries(counts)),
    percent: 95,
  };
}

describe("buildSmellsLane", () => {
  const codeLines = new Map([
    ["src/loose.ts", 100],
    ["src/tight.ts", 200],
    ["src/util.js", 50],
  ]);

  it("scores any-density on the ten-lines-per-any scale", () => {
    const result = buildSmellsLane(
      coverage({ "src/loose.ts": 10, "src/tight.ts": 1 }),
      ["src/loose.ts", "src/tight.ts"],
      codeLines,
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("src/loose.ts")?.score).toBeCloseTo(1.0);
    expect(byPath.get("src/tight.ts")?.score).toBeCloseTo(0.05);
    expect(result.typedPercent).toBe(95);
  });

  it("covers TS files only, and clean files keep applicable entries", () => {
    const result = buildSmellsLane(
      coverage({}),
      ["src/loose.ts", "src/util.js", "types/global.d.ts"],
      codeLines,
    );
    expect(result.entries.map((e) => e.path)).toEqual(["src/loose.ts"]);
    expect(result.entries[0].score).toBe(0);
  });

  it("caps runaway densities", () => {
    const result = buildSmellsLane(
      coverage({ "src/loose.ts": 500 }),
      ["src/loose.ts"],
      codeLines,
    );
    expect(result.entries[0].score).toBe(1.5);
  });

  it("degrades with disclosure when type-coverage cannot run", () => {
    const result = buildSmellsLane(
      { available: false, anyCounts: new Map(), percent: null },
      ["src/loose.ts"],
      codeLines,
    );
    expect(result.available).toBe(false);
    expect(result.disclosures.join(" ")).toMatch(/type-coverage unavailable/);
  });
});
