import { describe, expect, it } from "vitest";
import {
  binomialDraw,
  deriveInspectionK,
  inspectionHalfWidth,
  makeRng,
  simulateLift,
} from "../scripts/audit-power-sim.js";

describe("power simulation primitives", () => {
  it("seeded PRNG reproduces byte-identically", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("binomial draws track their expectation", () => {
    const rng = makeRng(7);
    let total = 0;
    for (let i = 0; i < 200; i++) total += binomialDraw(rng, 100, 0.3);
    expect(total / 200).toBeGreaterThan(25);
    expect(total / 200).toBeLessThan(35);
  });

  it("null-lift quantiles bracket 1 and tighten with n", () => {
    const small = simulateLift(makeRng(1), 20, 0.2, 1, 1000);
    const large = simulateLift(makeRng(1), 400, 0.2, 1, 1000);
    expect(small.q025).toBeLessThan(1);
    expect(small.q975).toBeGreaterThan(1);
    expect(large.q975 - large.q025).toBeLessThan(small.q975 - small.q025);
  });

  it("inspection CI half-width shrinks with k", () => {
    const w20 = inspectionHalfWidth(makeRng(3), 20, 0.5, 1000);
    const w200 = inspectionHalfWidth(makeRng(3), 200, 0.5, 1000);
    expect(w200).toBeLessThan(w20);
    // Sanity: k=20 at p=0.5 is roughly the ±20-point coin flip the design
    // doc calls out as underpowered.
    expect(w20).toBeGreaterThan(0.15);
  });

  it("derives an inspection k meeting the band target", () => {
    const { chosenK, halfWidths } = deriveInspectionK(9, 0.15, [10, 50, 120]);
    expect(chosenK).not.toBeNull();
    expect(halfWidths.get(chosenK as number)).toBeLessThanOrEqual(0.15);
  });
});
