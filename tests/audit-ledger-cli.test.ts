import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit/index.js";
import {
  applyRun,
  recordVerdict,
  resetFloor,
} from "../src/audit/ledger-cli.js";
import {
  foldLedger,
  makeUlid,
  readLedger,
  type VerdictEvent,
} from "../src/audit/ledger.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(prefix: string) {
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
  const commit = (message: string, files: Record<string, string>) => {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    git(["add", "-A"]);
    const date = `2026-03-${String(++index).padStart(2, "0")}T12:00:00Z`;
    git(["commit", "-q", "--no-verify", "-m", message], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  };
  return { root, git, commit };
}

function untestedFixture() {
  const repo = makeRepo("vibecheck-cli-");
  repo.commit("initial", {
    "src/naked.ts": "export const naked = 0;\n",
    // Test infrastructure must exist for the file's language family or
    // arrival abstains repo-wide; this test never reaches naked.ts.
    "tests/other.test.ts": "export const t = 1;\n",
    // The suppression loop only needs the arrival lane; the tool-backed
    // lanes would have npx fetching knip/jscpd inside a bare temp repo
    // on CI (slow, networked, and irrelevant here).
    "vibecheck.json": JSON.stringify({
      version: 1,
      audit: {
        lanes: {
          size: { enabled: false },
          deadcode: { enabled: false },
          duplication: { enabled: false },
          smells: { enabled: false },
          consistency: { enabled: false },
        },
      },
    }),
  });
  for (let round = 1; round <= 3; round++) {
    repo.commit(`grow ${round}`, {
      "src/naked.ts": `export const naked = ${round};\n`,
    });
  }
  return repo;
}

describe("verdict CLI → audit suppression loop", () => {
  it("files a verdict, commits it, and the next audit suppresses the finding", async () => {
    const repo = untestedFixture();
    const fingerprint = "arrival:src/naked.ts";

    const before = await runAudit({ rootPath: repo.root, stampLedger: false });
    const nakedBefore = before.fileScores.find((f) => f.path === "src/naked.ts");
    expect(
      nakedBefore?.firingLanes.map((f) => f.lane),
    ).toContain("arrival");

    recordVerdict(repo.root, "wontfix", fingerprint, "known untested corner", {});
    const log = repo.git(["log", "-1", "--format=%s"]).trim();
    expect(log).toBe(`vibecheck: wontfix ${fingerprint}`);

    const after = await runAudit({ rootPath: repo.root, stampLedger: false });
    const nakedAfter = after.fileScores.find((f) => f.path === "src/naked.ts");
    expect(nakedAfter?.firingLanes.map((f) => f.lane) ?? []).not.toContain(
      "arrival",
    );
    expect(
      after.ledger.suppressed.map((s) => s.fingerprint),
    ).toContain(fingerprint);
    expect(after.ledger.suppressed[0].status).toBe("wontfix");
  });

  it("justify captures a baseline and invalidation defaults", () => {
    const repo = untestedFixture();
    const event = recordVerdict(
      repo.root,
      "justified",
      "size:src/naked.ts",
      "cohesive module",
      { noCommit: true },
    );
    expect(event.invalidateWhen).toEqual({ growthPct: 20, maxAgeDays: 180 });
    // sha is best-effort but a git repo always yields one.
    expect(event.baseline?.sha).toMatch(/^[0-9a-f]+$/);
  });

  it("rejects fingerprints without a lane prefix", () => {
    const repo = untestedFixture();
    expect(() =>
      recordVerdict(repo.root, "noise", "src/naked.ts", "x", { noCommit: true }),
    ).toThrow(/lane/);
  });
});

describe("floors reset", () => {
  it("appends a reset event that zeroes the folded floor", () => {
    const repo = untestedFixture();
    for (let i = 0; i < 3; i++) {
      recordVerdict(repo.root, "noise", `arrival:src/f${i}.ts`, "wrong", {
        noCommit: true,
      });
    }
    expect(
      foldLedger(readLedger(repo.root)).floorSteps.get("arrival"),
    ).toBe(1);
    resetFloor(repo.root, "arrival", { noCommit: true });
    expect(
      foldLedger(readLedger(repo.root)).floorSteps.get("arrival"),
    ).toBe(0);
  });
});

describe("apply-run", () => {
  it("applies a run's events once, deduping repeat applications", () => {
    const repo = untestedFixture();
    const event: VerdictEvent = {
      id: makeUlid(),
      at: "2026-03-10T00:00:00.000Z",
      verdict: "wontfix",
      fingerprint: "arrival:src/naked.ts",
      reason: "from CI",
    };
    const runsDir = join(repo.root, ".vibecompact", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, "run-42.jsonl"), JSON.stringify(event) + "\n");

    expect(applyRun(repo.root, "run-42", { noCommit: true })).toBe(1);
    expect(applyRun(repo.root, "run-42", { noCommit: true })).toBe(0);
    expect(readLedger(repo.root)).toHaveLength(1);
  });

  it("fails loudly when the events file is missing", () => {
    const repo = untestedFixture();
    expect(() => applyRun(repo.root, "run-404", { noCommit: true })).toThrow(
      /No events file/,
    );
  });
});
