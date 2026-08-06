import type { AuditRunResult } from "../../src/audit/index.js";
import { DEFAULT_AUDIT_CONFIG } from "../../src/audit/config.js";

export function fixtureResult(rootPath = "/tmp/fixture"): AuditRunResult {
  return {
    rootPath,
    config: DEFAULT_AUDIT_CONFIG,
    anchorSha: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    lanesPlanned: ["size", "arrival"],
    candidateFiles: ["src/app.ts", "src/dumped.ts", "src/small.ts"],
    excluded: [{ path: "pnpm-lock.yaml", reason: "path-convention" }],
    history: null,
    lanes: {
      size: {
        lane: "size",
        available: true,
        toolVersion: "3.7.0",
        entries: [
          {
            path: "src/dumped.ts",
            language: "TypeScript",
            codeLines: 1483,
            complexity: 120,
            tier: 2,
            score: 2.966,
            cohesionModifier: 1,
          },
          {
            path: "src/app.ts",
            language: "TypeScript",
            codeLines: 640,
            complexity: 40,
            tier: 1,
            score: 1.28,
            cohesionModifier: 1,
          },
          {
            path: "src/small.ts",
            language: "TypeScript",
            codeLines: 90,
            complexity: 4,
            tier: 0,
            score: 0.18,
            cohesionModifier: 1,
          },
        ],
      },
      arrival: {
        lane: "arrival",
        available: true,
        disclosures: [
          "test co-change: 2 files graph-joined, 1 on commit granularity (demoted confidence)",
          "young repo: current import graph is near-exact for this history",
        ],
        bulkMuted: false,
        entries: [
          {
            path: "src/dumped.ts",
            touches: 14,
            applicable: true,
            untestedShare: 0.79,
            coChangeMode: "graph",
            bulkScore: 12.4,
            snapshotChurnShare: 0,
            score: 0.976,
          },
          {
            path: "src/app.ts",
            touches: 9,
            applicable: true,
            untestedShare: 0.67,
            coChangeMode: "graph",
            bulkScore: 1.2,
            snapshotChurnShare: 0.11,
            score: 0.7,
          },
        ],
      },
    },
    laneScores: [],
    fileScores: [],
    worstOffenders: [
      {
        path: "src/dumped.ts",
        applicableLanes: ["arrival", "size"],
        firingLanes: [
          { lane: "arrival", score: 0.976, threshold: 0.6 },
          { lane: "size", score: 2.966, threshold: 1 },
        ],
        suppressedByFloor: [],
        weightedScore: 4.593,
        gatePassed: true,
      },
      {
        path: "src/app.ts",
        applicableLanes: ["arrival", "size"],
        firingLanes: [
          { lane: "arrival", score: 0.7, threshold: 0.6 },
          { lane: "size", score: 1.28, threshold: 1 },
        ],
        suppressedByFloor: [],
        weightedScore: 2.447,
        gatePassed: true,
      },
    ],
    bestFirstTargets: [
      {
        path: "src/app.ts",
        applicableLanes: ["arrival", "size"],
        firingLanes: [
          { lane: "arrival", score: 0.7, threshold: 0.6 },
          { lane: "size", score: 1.28, threshold: 1 },
        ],
        suppressedByFloor: [],
        weightedScore: 2.447,
        gatePassed: true,
      },
    ],
    ledger: {
      floors: { arrival: 0.75 },
      suppressed: [
        {
          fingerprint: "size:src/legacy.ts",
          status: "wontfix",
          suppressed: true,
        },
      ],
      agingJustifications: [
        {
          id: "01AAAAAAAAAAAAAAAAAAAAAAAA",
          at: "2026-01-15T12:00:00Z",
          verdict: "justified",
          fingerprint: "size:src/hashing.ts",
          reason: "Single cohesive hashing module",
        },
      ],
      reopened: ["size:src/grew.ts"],
      stampedEvents: 3,
    },
    trends: {
      entry: {
        at: "2026-08-05T12:00:00Z",
        sha: "0123456789abcdef0123456789abcdef01234567",
        dirty: false,
        toolVersions: { scc: "3.7.0" },
        floors: { arrival: 0.75 },
        aggregates: {
          candidateFiles: 3,
          perLane: {
            size: { measured: 3, firing: 2 },
            arrival: { measured: 2, firing: 2 },
          },
          gatePassing: 2,
          offenders: 2,
          suppressedByFloor: 1,
        },
      },
      derivative: {
        baselineAt: "2026-07-01T12:00:00Z",
        baselineSha: "aaaa",
        spanDays: 35,
        offendersDelta: 1,
        firingDelta: { size: 1, arrival: 0 },
        trendBreaks: ["floor: arrival 0 → 0.75"],
        suppressedByFloorExcluded: 1,
      },
    },
  };
}
