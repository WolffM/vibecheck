import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIT_CONFIG,
  resolveAuditConfig,
} from "../src/audit/config.js";
import { buildSizeLane, sizeMultiplier } from "../src/audit/lanes/size.js";
import type { SccResult } from "../src/audit/runners/scc.js";

function scc(files: SccResult["files"]): SccResult {
  return { available: true, version: "3.5.0", files };
}

function metrics(path: string, language: string, codeLines: number) {
  return { path, language, codeLines, complexity: 0 };
}

const config = DEFAULT_AUDIT_CONFIG;

describe("buildSizeLane", () => {
  it("assigns tiers at the default boundaries", () => {
    const result = buildSizeLane(
      scc([
        metrics("tiny.ts", "TypeScript", 120),
        metrics("t1.ts", "TypeScript", 500),
        metrics("t2.ts", "TypeScript", 1000),
        metrics("t3.ts", "TypeScript", 2000),
        metrics("edge.ts", "TypeScript", 1999),
      ]),
      ["tiny.ts", "t1.ts", "t2.ts", "t3.ts", "edge.ts"],
      config,
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("tiny.ts")?.tier).toBe(0);
    expect(byPath.get("t1.ts")?.tier).toBe(1);
    expect(byPath.get("t2.ts")?.tier).toBe(2);
    expect(byPath.get("t3.ts")?.tier).toBe(3);
    expect(byPath.get("edge.ts")?.tier).toBe(2);
  });

  it("scales boundaries by language multiplier", () => {
    // Java multiplier 1.3: tier-1 boundary is 650 code lines.
    const result = buildSizeLane(
      scc([
        metrics("A.java", "Java", 600),
        metrics("B.java", "Java", 650),
        metrics("terse.py", "Python", 400),
      ]),
      ["A.java", "B.java", "terse.py"],
      config,
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(sizeMultiplier("Java")).toBe(1.3);
    expect(byPath.get("A.java")?.tier).toBe(0);
    expect(byPath.get("B.java")?.tier).toBe(1);
    // Python multiplier 0.8: tier-1 boundary is 400 code lines.
    expect(byPath.get("terse.py")?.tier).toBe(1);
  });

  it("scores as density against the adjusted tier-1 boundary", () => {
    const result = buildSizeLane(
      scc([metrics("x.ts", "TypeScript", 1000)]),
      ["x.ts"],
      config,
    );
    expect(result.entries[0].score).toBe(2);
    expect(result.entries[0].cohesionModifier).toBe(1);
  });

  it("only measures candidate files (exclusions respected)", () => {
    const result = buildSizeLane(
      scc([
        metrics("src/app.ts", "TypeScript", 700),
        metrics("dist/bundle.js", "JavaScript", 9000),
      ]),
      ["src/app.ts"],
      config,
    );
    expect(result.entries.map((e) => e.path)).toEqual(["src/app.ts"]);
  });

  it("respects custom size tiers from config", () => {
    const custom = resolveAuditConfig({ size_tiers: [100, 200, 300] });
    const result = buildSizeLane(
      scc([metrics("x.ts", "TypeScript", 250)]),
      ["x.ts"],
      custom,
    );
    expect(result.entries[0].tier).toBe(2);
  });

  it("degrades with disclosure when scc is missing", () => {
    const result = buildSizeLane(
      { available: false, version: null, files: [] },
      ["src/app.ts"],
      config,
    );
    expect(result.available).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.disclosure).toMatch(/scc not available/);
  });
});
