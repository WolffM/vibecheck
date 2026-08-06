/**
 * §10.1 power simulations — derives the audit's analytic constants.
 *
 * Analytic constants are derived, not declared: this script simulates
 * (a) lift confidence intervals at candidate group sizes for the
 * outcome-lane falsification test, and (b) binomial CI widths for the
 * state-lane inspection sample. Output is a markdown one-pager for
 * docs/audit-m1-notes.md. Seeded PRNG — byte-reproducible.
 *
 * Run: npx tsx scripts/audit-power-sim.ts
 */

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function binomialDraw(rng: () => number, n: number, p: number): number {
  let hits = 0;
  for (let i = 0; i < n; i++) if (rng() < p) hits++;
  return hits;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(q * (sorted.length - 1))),
  );
  return sorted[idx];
}

export interface LiftSim {
  n: number;
  baseRate: number;
  trueLift: number;
  /** 2.5% / 50% / 97.5% quantiles of the observed lift. */
  q025: number;
  median: number;
  q975: number;
}

/**
 * Observed lift distribution for treatment (rate = trueLift × baseRate)
 * vs an equal-size control group (rate = baseRate). Zero-control draws
 * fall back to the +1 continuity correction rather than dropping runs.
 */
export function simulateLift(
  rng: () => number,
  n: number,
  baseRate: number,
  trueLift: number,
  iterations = 4000,
): LiftSim {
  const lifts: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const treatment = binomialDraw(rng, n, Math.min(1, baseRate * trueLift));
    const control = binomialDraw(rng, n, baseRate);
    const treatmentRate = treatment / n;
    const controlRate = control === 0 ? 1 / (n + 1) : control / n;
    lifts.push(treatmentRate / controlRate);
  }
  lifts.sort((a, b) => a - b);
  return {
    n,
    baseRate,
    trueLift,
    q025: quantile(lifts, 0.025),
    median: quantile(lifts, 0.5),
    q975: quantile(lifts, 0.975),
  };
}

export interface FalsificationDerivation {
  baseRate: number;
  chosenN: number | null;
  /** Decision bands at chosenN: the null distribution's 2.5/97.5 quantiles. */
  lowerBand: number | null;
  upperBand: number | null;
  /** Share of true-lift-2 runs whose observed lift clears the upper band. */
  power: number | null;
}

/**
 * Smallest candidate n where the null (lift=1) 97.5% quantile sits below
 * 1.5 AND observed lift under a true lift of 2 clears that band in ≥80%
 * of runs. Between the bands: no decision, corner recorded untested.
 */
export function deriveFalsificationN(
  seed: number,
  baseRate: number,
  candidates: number[],
  iterations = 4000,
): FalsificationDerivation {
  for (const n of candidates) {
    const rng = makeRng(seed + n);
    const nullSim = simulateLift(rng, n, baseRate, 1, iterations);
    if (nullSim.q975 >= 1.5) continue;

    const rngAlt = makeRng(seed + n + 1_000_000);
    let clears = 0;
    for (let i = 0; i < iterations; i++) {
      const treatment = binomialDraw(rngAlt, n, Math.min(1, baseRate * 2));
      const control = binomialDraw(rngAlt, n, baseRate);
      const controlRate = control === 0 ? 1 / (n + 1) : control / n;
      if (treatment / n / controlRate > nullSim.q975) clears++;
    }
    const power = clears / iterations;
    if (power >= 0.8) {
      return {
        baseRate,
        chosenN: n,
        lowerBand: nullSim.q025,
        upperBand: nullSim.q975,
        power,
      };
    }
  }
  return {
    baseRate,
    chosenN: null,
    lowerBand: null,
    upperBand: null,
    power: null,
  };
}

/** Half-width of the exact-simulated 95% CI for a proportion at size k. */
export function inspectionHalfWidth(
  rng: () => number,
  k: number,
  p: number,
  iterations = 4000,
): number {
  const rates: number[] = [];
  for (let i = 0; i < iterations; i++) {
    rates.push(binomialDraw(rng, k, p) / k);
  }
  rates.sort((a, b) => a - b);
  return (quantile(rates, 0.975) - quantile(rates, 0.025)) / 2;
}

export function deriveInspectionK(
  seed: number,
  targetHalfWidth: number,
  candidates: number[],
): { chosenK: number | null; halfWidths: Map<number, number> } {
  const halfWidths = new Map<number, number>();
  let chosenK: number | null = null;
  for (const k of candidates) {
    // Worst case p = 0.5.
    const halfWidth = inspectionHalfWidth(makeRng(seed + k), k, 0.5);
    halfWidths.set(k, halfWidth);
    if (chosenK === null && halfWidth <= targetHalfWidth) chosenK = k;
  }
  return { chosenK, halfWidths };
}

const SEED = 0x5eed_a0d1;

function main(): void {
  const lines: string[] = [
    "### §10.1 power simulation results",
    "",
    `Seeded Monte Carlo (seed \`0x${SEED.toString(16)}\`, 4000 iterations/cell) — rerun \`npx tsx scripts/audit-power-sim.ts\` to reproduce byte-identically.`,
    "",
    "#### Observed-lift quantiles (treatment vs equal-size size-matched controls)",
    "",
    "| n/group | base rate | true lift | 2.5% | median | 97.5% |",
    "|---|---|---|---|---|---|",
  ];

  const candidates = [10, 20, 50, 100, 200, 400, 800];
  for (const baseRate of [0.1, 0.2, 0.3]) {
    for (const trueLift of [1, 2]) {
      for (const n of candidates) {
        const sim = simulateLift(makeRng(SEED + n), n, baseRate, trueLift);
        lines.push(
          `| ${n} | ${baseRate} | ${trueLift} | ${sim.q025.toFixed(2)} | ${sim.median.toFixed(2)} | ${sim.q975.toFixed(2)} |`,
        );
      }
    }
  }

  lines.push(
    "",
    "#### Derived analytic constants (banded decisions)",
    "",
    "| base rate | falsification n | lower band | upper band | power vs lift 2 |",
    "|---|---|---|---|---|",
  );
  for (const baseRate of [0.1, 0.2, 0.3]) {
    const d = deriveFalsificationN(SEED, baseRate, candidates);
    lines.push(
      d.chosenN === null
        ? `| ${baseRate} | >800 (unreachable at these candidates) | — | — | — |`
        : `| ${baseRate} | ${d.chosenN} | ${d.lowerBand?.toFixed(2)} | ${d.upperBand?.toFixed(2)} | ${((d.power ?? 0) * 100).toFixed(0)}% |`,
    );
  }

  const inspection = deriveInspectionK(SEED, 0.15, [10, 20, 30, 50, 80, 120, 200]);
  lines.push(
    "",
    "#### Inspection sample size (state lanes, worst case p = 0.5)",
    "",
    "| k inspected | 95% CI half-width |",
    "|---|---|",
  );
  for (const [k, halfWidth] of inspection.halfWidths) {
    lines.push(`| ${k} | ±${(halfWidth * 100).toFixed(0)} points |`);
  }
  lines.push(
    "",
    `Chosen inspection k (half-width ≤ ±15 points): **${inspection.chosenK ?? "none reached"}**.`,
    "",
    "Decision rule everywhere: override above the upper band, demote below the lower band, and **between the bands: no decision, corner recorded untested**.",
  );

  console.log(lines.join("\n"));
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) main();
