/**
 * M1 dogfood calibration (T11)
 *
 * Runs the audit read-only (no ledger stamping, no local sink) across one
 * or more repos and reports the numbers the M1 exit wants:
 *  - lane score distributions and firing rates at the current anchors
 *  - firing-set Jaccard + conditional Spearman (independence, provisional)
 *  - anchor perturbation ±1 step (25%) → worst-offender ordering stability
 *
 * Run: npx tsx scripts/audit-calibration.ts <repo-path> [...more]
 */

import { runAudit } from "../src/audit/index.js";
import {
  LANE_ANCHORS,
  scoreFiles,
  worstOffenders,
  type LaneScore,
} from "../src/audit/scoring.js";

function quantiles(values: number[]): string {
  if (values.length === 0) return "no data";
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
  return `p25=${q(0.25).toFixed(2)} p50=${q(0.5).toFixed(2)} p75=${q(0.75).toFixed(2)} p90=${q(0.9).toFixed(2)} max=${q(1).toFixed(2)}`;
}

function spearman(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null;
  const rank = (values: number[]): number[] => {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
      const avg = (i + j) / 2;
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = avg;
      i = j + 1;
    }
    return ranks;
  };
  const xs = rank(pairs.map((p) => p[0]));
  const ys = rank(pairs.map((p) => p[1]));
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let k = 0; k < xs.length; k++) {
    cov += (xs[k] - mx) * (ys[k] - my);
    vx += (xs[k] - mx) ** 2;
    vy += (ys[k] - my) ** 2;
  }
  return vx === 0 || vy === 0 ? null : cov / Math.sqrt(vx * vy);
}

async function calibrate(rootPath: string): Promise<void> {
  console.log(`\n=== ${rootPath} ===`);
  const result = await runAudit({ rootPath, stampLedger: false });

  const sizeScores = (result.lanes.size?.entries ?? []).map((e) => e.score);
  const arrivalApplicable = (result.lanes.arrival?.entries ?? []).filter(
    (e) => e.applicable,
  );
  const arrivalScores = arrivalApplicable.map((e) => e.score);

  console.log(
    `files: ${result.candidateFiles.length} candidates, ` +
      `${result.excluded.length} excluded; ` +
      `young-repo: ${result.history?.age.youngRepo ?? "n/a"}; ` +
      `squash-dominant: ${result.history?.workflowShape.squashDominant ?? "n/a"}`,
  );
  console.log(`size scores    (${sizeScores.length}): ${quantiles(sizeScores)}`);
  console.log(
    `arrival scores (${arrivalScores.length} applicable): ${quantiles(arrivalScores)}`,
  );

  const laneScores: LaneScore[] = [
    ...(result.lanes.size?.entries ?? []).map((e) => ({
      lane: "size",
      path: e.path,
      score: e.score,
      applicable: true,
    })),
    ...(result.lanes.arrival?.entries ?? []).map((e) => ({
      lane: "arrival",
      path: e.path,
      score: e.score,
      applicable: e.applicable,
    })),
  ];

  const firing = (lane: string, anchor: number) =>
    new Set(
      laneScores
        .filter((s) => s.lane === lane && s.applicable && s.score >= anchor)
        .map((s) => s.path),
    );
  const sizeFiring = firing("size", LANE_ANCHORS.size);
  const arrivalFiring = firing("arrival", LANE_ANCHORS.arrival);
  const sizePool = new Set(
    laneScores.filter((s) => s.lane === "size").map((s) => s.path),
  );
  const arrivalPool = new Set(arrivalApplicable.map((e) => e.path));
  console.log(
    `firing rates: size ${sizeFiring.size}/${sizePool.size}, ` +
      `arrival ${arrivalFiring.size}/${arrivalPool.size}`,
  );

  const intersection = [...sizeFiring].filter((p) => arrivalFiring.has(p));
  const union = new Set([...sizeFiring, ...arrivalFiring]);
  const jaccard =
    union.size === 0 ? null : intersection.length / union.size;

  const scoreByPath = new Map<string, { size?: number; arrival?: number }>();
  for (const s of laneScores) {
    if (!s.applicable) continue;
    const entry = scoreByPath.get(s.path) ?? {};
    entry[s.lane as "size" | "arrival"] = s.score;
    scoreByPath.set(s.path, entry);
  }
  const pairs: [number, number][] = [...scoreByPath.values()]
    .filter(
      (e) =>
        e.size !== undefined &&
        e.arrival !== undefined &&
        (e.size > 0 || e.arrival > 0),
    )
    .map((e) => [e.size as number, e.arrival as number]);
  const rho = spearman(pairs);
  console.log(
    `independence: firing-set Jaccard ${jaccard === null ? "n/a" : jaccard.toFixed(2)} (gate ≤0.5), ` +
      `conditional Spearman ${rho === null ? "n/a" : rho.toFixed(2)} over ${pairs.length} files (gate ≤0.6)`,
  );

  // Anchor perturbation ±1 step (25%): ordering stability of offenders.
  const baseline = worstOffenders(scoreFiles(laneScores), 15).map((f) => f.path);
  console.log(`offenders @ current anchors: [${baseline.join(", ")}]`);
  for (const lane of Object.keys(LANE_ANCHORS)) {
    for (const factor of [0.75, 1.25]) {
      const anchors = {
        ...LANE_ANCHORS,
        [lane]: LANE_ANCHORS[lane] * factor,
      };
      const perturbed = worstOffenders(scoreFiles(laneScores, { anchors }), 15).map(
        (f) => f.path,
      );
      const common = baseline.filter((p) => perturbed.includes(p));
      const orderStable = common.every(
        (p, i) =>
          perturbed.indexOf(p) ===
          perturbed.indexOf(common[0]) + i -
            common.indexOf(common[0]),
      );
      console.log(
        `perturb ${lane} ×${factor}: ${perturbed.length} offenders, ` +
          `${common.length}/${baseline.length} of baseline retained, ` +
          `relative order ${orderStable ? "stable" : "CHANGED"}` +
          (perturbed.length !== baseline.length
            ? ` (set: [${perturbed.join(", ")}])`
            : ""),
      );
    }
  }
}

async function main(): Promise<void> {
  const repos = process.argv.slice(2);
  if (repos.length === 0) {
    console.error(
      "Usage: npx tsx scripts/audit-calibration.ts <repo-path> [...more]",
    );
    process.exit(1);
  }
  for (const repo of repos) {
    await calibrate(repo);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
