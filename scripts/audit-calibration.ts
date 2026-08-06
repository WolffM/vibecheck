/**
 * Dogfood calibration (M1 T11, generalized for all lanes in M2)
 *
 * Runs the audit read-only (no ledger stamping, no local sink) across one
 * or more repos and reports the exit-criteria numbers:
 *  - per-lane score distributions and firing rates at current anchors
 *  - pairwise firing-set Jaccard + conditional Spearman (independence)
 *  - anchor perturbation ±1 step (25%) → worst-offender ordering stability
 *
 * Run: npx tsx scripts/audit-calibration.ts <repo-path> [...more]
 */

import { runAudit } from "../src/audit/index.js";
import {
  LANE_ANCHORS,
  scoreFiles,
  worstOffenders,
} from "../src/audit/scoring.js";

function quantiles(values: number[]): string {
  if (values.length === 0) return "no data";
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
  return `p50=${q(0.5).toFixed(2)} p75=${q(0.75).toFixed(2)} p90=${q(0.9).toFixed(2)} max=${q(1).toFixed(2)}`;
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
  const laneScores = result.laneScores;
  const lanes = [...new Set(laneScores.map((s) => s.lane))].sort();

  console.log(
    `files: ${result.candidateFiles.length} candidates, ` +
      `${result.excluded.length} excluded; ` +
      `young-repo: ${result.history?.age.youngRepo ?? "n/a"}; ` +
      `squash-dominant: ${result.history?.workflowShape.squashDominant ?? "n/a"}`,
  );

  const firingSets = new Map<string, Set<string>>();
  for (const lane of lanes) {
    const applicable = laneScores.filter((s) => s.lane === lane && s.applicable);
    const firing = applicable.filter((s) => s.score >= (LANE_ANCHORS[lane] ?? 1));
    firingSets.set(lane, new Set(firing.map((s) => s.path)));
    console.log(
      `${lane.padEnd(12)} firing ${String(firing.length).padStart(4)}/${String(applicable.length).padEnd(5)} ${quantiles(applicable.map((s) => s.score))}`,
    );
  }

  console.log("independence (pairs with both lanes firing somewhere):");
  const scoreByPath = new Map<string, Map<string, number>>();
  for (const s of laneScores) {
    if (!s.applicable) continue;
    const entry = scoreByPath.get(s.path) ?? new Map<string, number>();
    entry.set(s.lane, s.score);
    scoreByPath.set(s.path, entry);
  }
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const a = firingSets.get(lanes[i]) as Set<string>;
      const b = firingSets.get(lanes[j]) as Set<string>;
      if (a.size === 0 || b.size === 0) continue;
      const intersection = [...a].filter((p) => b.has(p)).length;
      const union = new Set([...a, ...b]).size;
      const pairs: [number, number][] = [];
      for (const entry of scoreByPath.values()) {
        const x = entry.get(lanes[i]);
        const y = entry.get(lanes[j]);
        if (x !== undefined && y !== undefined && (x > 0 || y > 0)) {
          pairs.push([x, y]);
        }
      }
      const rho = spearman(pairs);
      console.log(
        `  ${lanes[i]}×${lanes[j]}: Jaccard ${(intersection / union).toFixed(2)}` +
          `, cond. Spearman ${rho === null ? "n/a" : rho.toFixed(2)} (n=${pairs.length})`,
      );
    }
  }

  const baseline = worstOffenders(scoreFiles(laneScores), 15).map((f) => f.path);
  console.log(`offenders @ current anchors: [${baseline.join(", ")}]`);
  for (const lane of lanes) {
    for (const factor of [0.75, 1.25]) {
      const anchors = {
        ...LANE_ANCHORS,
        [lane]: (LANE_ANCHORS[lane] ?? 1) * factor,
      };
      const perturbed = worstOffenders(scoreFiles(laneScores, { anchors }), 15).map(
        (f) => f.path,
      );
      const common = baseline.filter((p) => perturbed.includes(p));
      const commonInPerturbedOrder = perturbed.filter((p) => common.includes(p));
      const orderStable =
        JSON.stringify(common) === JSON.stringify(commonInPerturbedOrder);
      const delta = perturbed.length - baseline.length;
      console.log(
        `  perturb ${lane} ×${factor}: ${common.length}/${baseline.length} retained, ` +
          `${delta >= 0 ? "+" : ""}${delta} entries, order ${orderStable ? "stable" : "CHANGED"}`,
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
