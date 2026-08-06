import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_AUDIT_CONFIG, resolveAuditConfig } from "../src/audit/config.js";
import {
  evaluateGate,
  GATE_STALENESS_DAYS,
  GATE_VOLUME_LINES,
} from "../src/audit/gate.js";
import { appendEvents, makeUlid } from "../src/audit/ledger.js";
import { appendTrendEntry, type TrendEntry } from "../src/audit/trends.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  headSha: () => string;
  commit: (message: string, files: Record<string, string>, date?: string) => void;
}

function makeRepo(prefix: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(root);
  const git = (args: string[], env: Record<string, string> = {}) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, ...env },
    });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  let index = 0;
  return {
    root,
    headSha: () => git(["rev-parse", "HEAD"]).trim(),
    commit(message, files, date) {
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), content);
      }
      git(["add", "-A"]);
      const at = date ?? `2026-04-${String(++index).padStart(2, "0")}T12:00:00Z`;
      git(["commit", "-q", "--no-verify", "-m", message], {
        GIT_AUTHOR_DATE: at,
        GIT_COMMITTER_DATE: at,
      });
    },
  };
}

function trendEntry(sha: string, at: string): TrendEntry {
  return {
    at,
    sha,
    dirty: false,
    toolVersions: {},
    floors: {},
    aggregates: {
      candidateFiles: 1,
      perLane: {},
      gatePassing: 0,
      offenders: 0,
      suppressedByFloor: 0,
    },
  };
}

function lines(n: number, tag: string): string {
  return Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join("\n") + "\n";
}

const config = DEFAULT_AUDIT_CONFIG;

describe("evaluateGate", () => {
  it("fails open on a repo with no audit history", () => {
    const repo = makeRepo("vibecheck-gate-fresh-");
    repo.commit("initial", { "src/a.ts": "export const a = 1;\n" });
    const decision = evaluateGate(repo.root, config);
    expect(decision).toMatchObject({ active: true, reason: "first-audit" });
  });

  it("fails open when the last audited SHA is unreachable", () => {
    const repo = makeRepo("vibecheck-gate-rewrite-");
    repo.commit("initial", { "src/a.ts": "export const a = 1;\n" });
    appendTrendEntry(
      repo.root,
      trendEntry("f".repeat(40), "2026-04-01T12:00:00Z"),
    );
    expect(evaluateGate(repo.root, config).reason).toBe("history-unreadable");
  });

  it("stays quiet below every threshold", () => {
    const repo = makeRepo("vibecheck-gate-quiet-");
    repo.commit("initial", { "src/a.ts": "export const a = 1;\n" });
    appendTrendEntry(repo.root, trendEntry(repo.headSha(), "2026-04-01T12:00:00Z"));
    repo.commit("small tweak", { "src/a.ts": "export const a = 2;\n" });
    const decision = evaluateGate(repo.root, config);
    expect(decision).toMatchObject({ active: false, reason: "quiet" });
  });

  it("fires fix-confirmation when a firing file is touched", () => {
    const repo = makeRepo("vibecheck-gate-fix-");
    repo.commit("initial", { "src/hot.ts": "export const hot = 1;\n" });
    appendTrendEntry(repo.root, trendEntry(repo.headSha(), "2026-04-01T12:00:00Z"));
    appendEvents(repo.root, [
      {
        id: makeUlid(),
        at: "2026-04-01T12:00:00Z",
        kind: "firing",
        fingerprint: "size:src/hot.ts",
        score: 2,
        threshold: 1,
      },
    ]);
    repo.commit("refactor the offender", { "src/hot.ts": "export const hot = 2;\n" });
    const decision = evaluateGate(repo.root, config);
    expect(decision).toMatchObject({ active: true, reason: "fix-confirmation" });
    expect(decision.detail).toContain("src/hot.ts");
  });

  it("does not fire fix-confirmation for already-fixed findings", () => {
    const repo = makeRepo("vibecheck-gate-fixed-");
    repo.commit("initial", { "src/cool.ts": "export const cool = 1;\n" });
    appendTrendEntry(repo.root, trendEntry(repo.headSha(), "2026-04-01T12:00:00Z"));
    appendEvents(repo.root, [
      {
        id: makeUlid(),
        at: "2026-03-01T12:00:00Z",
        kind: "firing",
        fingerprint: "size:src/cool.ts",
        score: 2,
        threshold: 1,
      },
      {
        id: makeUlid(),
        at: "2026-03-08T12:00:00Z",
        verdict: "fixed",
        fingerprint: "size:src/cool.ts",
        score: 0.2,
        threshold: 1,
      },
    ]);
    repo.commit("touch it again lightly", { "src/cool.ts": "export const cool = 2;\n" });
    expect(evaluateGate(repo.root, config).reason).toBe("quiet");
  });

  it("fires on volume at the tier-3-boundary threshold", () => {
    const repo = makeRepo("vibecheck-gate-volume-");
    repo.commit("initial", { "src/a.ts": "export const a = 1;\n" });
    appendTrendEntry(repo.root, trendEntry(repo.headSha(), "2026-04-01T12:00:00Z"));
    repo.commit("big dump", { "src/dump.ts": lines(GATE_VOLUME_LINES, "d") });
    const decision = evaluateGate(repo.root, config);
    expect(decision).toMatchObject({ active: true, reason: "volume" });
  });

  it("ignores excluded-path churn in the volume count", () => {
    const repo = makeRepo("vibecheck-gate-excluded-");
    repo.commit("initial", { "src/a.ts": "export const a = 1;\n" });
    appendTrendEntry(repo.root, trendEntry(repo.headSha(), "2026-04-01T12:00:00Z"));
    repo.commit("vendored + config-excluded churn", {
      "dist/bundle.js": lines(3000, "v"),
      "generated/big.ts": lines(3000, "g"),
    });
    const custom = resolveAuditConfig({ exclude: ["generated"] });
    expect(evaluateGate(repo.root, custom).reason).toBe("quiet");
  });

  it("fires the staleness backstop on old-but-active repos", () => {
    const repo = makeRepo("vibecheck-gate-stale-");
    repo.commit("initial", { "src/a.ts": "export const a = 1;\n" });
    appendTrendEntry(repo.root, trendEntry(repo.headSha(), "2026-01-01T12:00:00Z"));
    // One tiny commit, dated past the backstop relative to the audit.
    repo.commit(
      "tiny tweak months later",
      { "src/a.ts": "export const a = 2;\n" },
      `2026-01-01T12:00:00Z`,
    );
    // HEAD date must exceed the backstop; re-commit with a late date.
    repo.commit(
      "another tiny tweak",
      { "src/a.ts": "export const a = 3;\n" },
      new Date(
        Date.parse("2026-01-01T12:00:00Z") +
          (GATE_STALENESS_DAYS + 1) * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
    const decision = evaluateGate(repo.root, config);
    expect(decision).toMatchObject({ active: true, reason: "staleness" });
  });
});
