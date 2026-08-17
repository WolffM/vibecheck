import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { publishLocal } from "../src/audit/publish/local.js";
import { buildMachineResult, renderAuditReport } from "../src/audit/report.js";
import { fixtureResult } from "./helpers/audit-fixture.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});


describe("renderAuditReport", () => {
  it("matches the golden report byte for byte", () => {
    const golden = readFileSync(
      join(__dirname, "golden", "audit-report.golden.md"),
      "utf-8",
    );
    expect(renderAuditReport(fixtureResult())).toBe(golden);
  });

  it("is deterministic across repeated renders", () => {
    expect(renderAuditReport(fixtureResult())).toBe(
      renderAuditReport(fixtureResult()),
    );
  });

  it("never leaks unrounded scores into the body", () => {
    const body = renderAuditReport(fixtureResult()).replace(
      /## Appendix[\s\S]*/,
      "",
    );
    // Quantized floors (0.75) and tool versions (3.7.0) are fine; raw
    // weighted scores (4.593, 0.976) are not.
    expect(body).not.toMatch(/\d\.\d{3,}/);
  });

  it("replaces the clean-bill headline with a coverage warning when lanes are down", () => {
    const result = fixtureResult();
    result.lanesPlanned = ["size", "arrival", "deadcode", "duplication", "smells", "consistency"];
    result.coverageGaps = [
      { lane: "deadcode", note: "knip unavailable — TS/JS dead code not assessed" },
      { lane: "smells", note: "type-coverage unavailable — smells lane skipped" },
      { lane: "duplication", note: "jscpd unavailable" },
    ];
    result.worstOffenders = [];
    result.bestFirstTargets = [];
    result.fileScores = [
      {
        path: "src/app.ts",
        applicableLanes: ["size"],
        firingLanes: [{ lane: "size", score: 1.28, threshold: 1 }],
        suppressedByFloor: [],
        weightedScore: 1.28,
        gatePassed: false,
      },
    ];
    const report = renderAuditReport(result);
    expect(report).toContain("**Coverage warning** — 3 of 6 planned lanes unavailable or degraded");
    expect(report).toContain("a coverage statement, not a health claim");
    expect(report).toContain("1 file fired on a single lane and could not be corroborated");
    // The offenders section must not read as a clean bill.
    expect(report).toContain("Not evaluable at full strength — 3 of 6 planned lanes");
    expect(report).not.toContain("None. No file passes");
  });

  it("ships every lane the summaries quote counts for in the machine payload", () => {
    const result = fixtureResult();
    result.lanes.deadcode = {
      lane: "deadcode",
      available: true,
      disclosures: [],
      filesSignalMuted: false,
      coverage: ["python"],
      entries: [
        {
          path: "src/dead.py",
          applicable: true,
          unusedFile: false,
          deadItems: 1,
          definitionCount: 4,
          deadDetail: [{ name: "unused_helper", line: 12 }],
          score: 0.25,
        },
        {
          path: "src/alive.py",
          applicable: true,
          unusedFile: false,
          deadItems: 0,
          definitionCount: 3,
          deadDetail: [],
          score: 0,
        },
      ],
    };
    result.lanes.duplication = {
      lane: "duplication",
      available: true,
      dirPairs: [],
      entries: [
        {
          path: "src/a.ts",
          codeLines: 100,
          duplicatedLines: 40,
          clusterFanOut: 1,
          clones: [
            { start: 1, end: 40, partner: "src/b.ts", partnerStart: 5, partnerEnd: 44 },
          ],
          score: 0.4,
        },
      ],
    };
    const machine = buildMachineResult(result) as {
      lanes: Record<string, { entries?: unknown[]; assessedCount?: number }>;
    };
    expect(machine.lanes.deadcode?.entries).toHaveLength(1);
    expect(machine.lanes.deadcode?.assessedCount).toBe(2);
    expect(machine.lanes.duplication?.entries).toHaveLength(1);
    expect(
      JSON.stringify(machine.lanes.duplication?.entries),
    ).toContain('"partner":"src/b.ts"');
  });
});

describe("publishLocal", () => {
  it("writes audit.md and out/audit.json under .vibecheck", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecheck-publish-"));
    cleanups.push(root);
    const { reportPath, machinePath } = publishLocal(fixtureResult(root));
    expect(reportPath).toBe(join(root, ".vibecompact", "audit.md"));
    expect(readFileSync(reportPath, "utf-8")).toContain("# vibeCompact");
    const machine = JSON.parse(readFileSync(machinePath, "utf-8"));
    expect(machine.worstOffenders).toEqual(["src/dumped.ts", "src/app.ts"]);
    expect(machine.anchorSha).toMatch(/^0123/);
  });

  // A local run used to rmSync BOTH findings directories while writing only
  // one, so it deleted the tracked packages a CI run had delivered and never
  // put them back — leaving the checkout dirty with deletions after every
  // local `vibecheck audit`.
  it("leaves tracked findings alone when writing to out/", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecheck-publish-"));
    cleanups.push(root);
    const tracked = join(root, ".vibecompact", "findings");
    mkdirSync(tracked, { recursive: true });
    const delivered = join(tracked, "DELETE__from__ci.md");
    writeFileSync(delivered, "# delivered by CI\n", "utf-8");

    const { findingsDir } = publishLocal(fixtureResult(root));

    expect(findingsDir).toBe(join(root, ".vibecompact", "out", "findings"));
    expect(existsSync(delivered)).toBe(true);
    expect(readFileSync(delivered, "utf-8")).toContain("delivered by CI");
  });

  it("still regenerates the tracked dir wholesale on the CI path", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecheck-publish-"));
    cleanups.push(root);
    const tracked = join(root, ".vibecompact", "findings");
    mkdirSync(tracked, { recursive: true });
    const stale = join(tracked, "STALE__resolved__finding.md");
    writeFileSync(stale, "# resolved last run\n", "utf-8");

    const { findingsDir } = publishLocal(fixtureResult(root), {
      trackedCopies: true,
    });

    expect(findingsDir).toBe(tracked);
    // Resolved findings' packages must still vanish with them.
    expect(existsSync(stale)).toBe(false);
  });
});
