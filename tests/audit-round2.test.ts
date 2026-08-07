import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { deletionCandidates, renderAgentBriefing } from "../src/audit/briefing.js";
import { detectEntryPoints } from "../src/audit/entrypoints.js";
import { buildDeadcodeLane } from "../src/audit/lanes/deadcode.js";
import { computeRunEvents, foldLedger } from "../src/audit/ledger.js";
import {
  detectSaturatedLanes,
  SATURATION_FIRING_RATE,
  SATURATION_MIN_APPLICABLE,
  type LaneScore,
} from "../src/audit/scoring.js";
import { computeDerivative, type TrendEntry } from "../src/audit/trends.js";
import { fixtureResult } from "./helpers/audit-fixture.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vibecheck-r2-"));
  cleanups.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

describe("detectEntryPoints", () => {
  it("maps dist-published package entries back to their sources", () => {
    const root = makeRoot({
      "package.json": JSON.stringify({
        main: "dist/index.js",
        bin: { tool: "dist/cli.js" },
        exports: {
          "./api": { types: "./dist/server/index.d.ts", default: "./dist/server/index.js" },
        },
        scripts: { start: "node scripts/serve.mjs" },
      }),
    });
    const files = [
      "package.json",
      "src/index.ts",
      "src/cli.ts",
      "src/server/index.ts",
      "scripts/serve.mjs",
      "src/unrelated.ts",
    ];
    const { entries, sources } = detectEntryPoints(root, files);
    expect(entries).toEqual(
      new Set(["src/index.ts", "src/cli.ts", "src/server/index.ts", "scripts/serve.mjs"]),
    );
    expect(sources.get("src/server/index.ts")).toBe("package.json");
  });

  it("back-maps nested-package dist exports to their sources", () => {
    const root = makeRoot({
      "packages/logger/package.json": JSON.stringify({
        exports: { "./worker": { default: "./dist/worker.js" } },
      }),
    });
    const files = [
      "packages/logger/package.json",
      "packages/logger/src/worker.ts",
    ];
    const { entries } = detectEntryPoints(root, files);
    expect(entries.has("packages/logger/src/worker.ts")).toBe(true);
  });

  it("reads framework-template references, including ?raw imports", () => {
    const root = makeRoot({
      "src/components/MicroFrontend.astro":
        "---\nimport loader from './mf-loader.js?raw'\n---\n<script src=\"./widget.js\"></script>",
    });
    const files = [
      "src/components/MicroFrontend.astro",
      "src/components/mf-loader.js",
      "src/components/widget.js",
    ];
    const { entries } = detectEntryPoints(root, files);
    expect(entries.has("src/components/mf-loader.js")).toBe(true);
    expect(entries.has("src/components/widget.js")).toBe(true);
  });

  it("finds wrangler mains, pm2 scripts, and HTML script tags", () => {
    const root = makeRoot({
      "workers/api/wrangler.toml": 'name = "api"\nmain = "src/worker.ts"\n',
      "ecosystem.config.cjs":
        "module.exports = { apps: [{ script: 'services/pm2/wrapper.mjs' }] }",
      "site/index.html": '<html><script src="./player.js"></script></html>',
    });
    const files = [
      "workers/api/wrangler.toml",
      "workers/api/src/worker.ts",
      "ecosystem.config.cjs",
      "services/pm2/wrapper.mjs",
      "site/index.html",
      "site/player.js",
    ];
    const { entries } = detectEntryPoints(root, files);
    expect(entries.has("workers/api/src/worker.ts")).toBe(true);
    expect(entries.has("services/pm2/wrapper.mjs")).toBe(true);
    expect(entries.has("site/player.js")).toBe(true);
  });
});

describe("deadcode entry-point awareness", () => {
  it("never claims a declared entry's surface is dead", () => {
    const result = buildDeadcodeLane(
      {
        available: true,
        unusedFiles: ["src/entry.ts"],
        unusedExports: new Map([
          [
            "src/entry.ts",
            Array.from({ length: 8 }, (_, i) => ({
              name: `e${i}`,
              line: i + 1,
              kind: "export" as const,
            })),
          ],
          [
            "src/other.ts",
            [
              { name: "deadA", line: 2, kind: "export" as const },
              { name: "deadB", line: 5, kind: "export" as const },
            ],
          ],
        ]),
      },
      { available: false, items: [] },
      ["src/entry.ts", "src/other.ts"],
      new Map([
        ["src/entry.ts", 8],
        ["src/other.ts", 4],
      ]),
      new Set(["src/entry.ts"]),
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("src/entry.ts")?.score).toBe(0);
    expect(byPath.get("src/entry.ts")?.unusedFile).toBe(false);
    expect(byPath.get("src/other.ts")?.score).toBeCloseTo(0.5);
    expect(result.disclosures.join(" ")).toMatch(/entry points exempt/);
  });
});

describe("saturation mute", () => {
  function scores(lane: string, firing: number, quiet: number): LaneScore[] {
    return [
      ...Array.from({ length: firing }, (_, i) => ({
        lane,
        path: `src/f${i}.ts`,
        score: 1.05,
        applicable: true,
      })),
      ...Array.from({ length: quiet }, (_, i) => ({
        lane,
        path: `src/q${i}.ts`,
        score: 0.1,
        applicable: true,
      })),
    ];
  }

  it("detects a lane firing above the threshold rate", () => {
    const saturated = detectSaturatedLanes(scores("arrival", 18, 6));
    expect(saturated.get("arrival")).toBeCloseTo(0.75);
    expect(SATURATION_FIRING_RATE).toBeLessThanOrEqual(0.75);
  });

  it("needs a minimum applicable sample", () => {
    const saturated = detectSaturatedLanes(
      scores("arrival", SATURATION_MIN_APPLICABLE - 5, 0),
    );
    expect(saturated.size).toBe(0);
  });

  it("leaves discriminating lanes alone", () => {
    expect(detectSaturatedLanes(scores("size", 3, 30)).size).toBe(0);
  });

  it("does not mass-stamp fixed for a muted lane's standing firings", () => {
    const firing = computeRunEvents(
      foldLedger([]),
      new Map([["arrival:src/f.ts", { score: 1.05, threshold: 1 }]]),
      "2026-08-01T00:00:00Z",
    );
    const fold = foldLedger(firing);
    // Saturation mute: lane absent from currentScores but listed in skipLanes.
    const events = computeRunEvents(
      fold,
      new Map(),
      "2026-08-08T00:00:00Z",
      new Set(["arrival"]),
    );
    expect(events).toHaveLength(0);
  });

  it("flags saturation changes as trend breaks", () => {
    const base: TrendEntry = {
      at: "2026-07-01T00:00:00Z",
      sha: "a",
      dirty: false,
      toolVersions: {},
      floors: {},
      saturated: [],
      aggregates: {
        candidateFiles: 1,
        perLane: {},
        gatePassing: 0,
        offenders: 0,
        suppressedByFloor: 0,
      },
    };
    const current: TrendEntry = {
      ...base,
      at: "2026-08-05T00:00:00Z",
      sha: "b",
      saturated: ["arrival"],
    };
    const derivative = computeDerivative([base, current], current);
    expect(derivative?.trendBreaks).toContain("saturation: [none] → [arrival]");
  });
});

describe("agent briefing", () => {
  it("renders work items with actions, verdict commands, and machine pointer", () => {
    const briefing = renderAgentBriefing(fixtureResult());
    expect(briefing).toContain("# vibeCheck Audit — agent briefing");
    expect(briefing).toContain("src/dumped.ts");
    expect(briefing).toContain("split along responsibility boundaries");
    expect(briefing).toContain('vibecheck wontfix|noise|justify "arrival:src/app.ts"');
    expect(briefing).toContain(".vibecheck/out/audit.json");
    // Execution order: best-first target (app.ts) before the bigger offender.
    expect(briefing.indexOf("### 1. `src/app.ts`")).toBeGreaterThan(-1);
    expect(briefing.indexOf("src/app.ts")).toBeLessThan(
      briefing.indexOf("### 2. `src/dumped.ts`"),
    );
  });

  it("lists verified-orphan deletion candidates below the gate", () => {
    const result = fixtureResult();
    result.lanes.consistency = {
      lane: "consistency",
      available: true,
      disclosures: [],
      categoryFindings: [],
      entries: [
        {
          path: "src/lonely.ts",
          applicable: true,
          orphan: true,
          score: 0.8,
        },
      ],
    };
    const candidates = deletionCandidates(result);
    expect(candidates).toEqual([
      {
        path: "src/lonely.ts",
        reason: "orphaned — zero import fan-in, no declared entry point",
      },
    ]);
  });

  it("carries the improving annotation into the report evidence", async () => {
    const { renderAuditReport } = await import("../src/audit/report.js");
    const report = renderAuditReport(fixtureResult());
    expect(report).toContain("**improving** — size score down 18% since first flagged");
  });
});
