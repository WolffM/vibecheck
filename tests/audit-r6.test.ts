import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  mergeDataBranchTrends,
  readDataBranchLedger,
} from "../src/audit/data-branch.js";
import { DEFAULT_AUDIT_CONFIG } from "../src/audit/config.js";
import { evaluateGate } from "../src/audit/gate.js";
import { makeUlid, writeUnionLedger } from "../src/audit/ledger.js";
import { renderSkill } from "../src/audit/skill-cli.js";
import { appendTrendEntry, type TrendEntry } from "../src/audit/trends.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function makeRepoWithDataBranch(prefix: string) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(base);
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, ...env },
    });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, work]);
  git(work, ["config", "user.email", "t@example.com"]);
  git(work, ["config", "user.name", "T"]);
  const commit = (message: string, files: Record<string, string>, date: string) => {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(work, rel)), { recursive: true });
      writeFileSync(join(work, rel), content);
    }
    git(work, ["add", "-A"]);
    git(work, ["commit", "-q", "--no-verify", "-m", message], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  };
  return { work, origin, git, commit };
}

describe("data-branch fold (never-merged PR topology)", () => {
  it("gate fix-confirmation fires from firing events that live only on the branch", () => {
    const repo = makeRepoWithDataBranch("vibecompact-branchfold-");
    repo.commit(
      "initial",
      { "src/hot.ts": "export const hot = 1;\n" },
      "2026-05-01T12:00:00Z",
    );
    repo.git(repo.work, ["push", "-q", "origin", "main"]);
    const auditedSha = repo
      .git(repo.work, ["rev-parse", "HEAD"])
      .trim();

    // Machine state exists ONLY on the data branch: a firing event plus
    // the trends entry recording the audited SHA.
    const branchDir = mkdtempSync(join(tmpdir(), "vibecompact-branchwt-"));
    cleanups.push(branchDir);
    repo.git(repo.work, ["worktree", "add", "-q", branchDir, "-b", "vibecompact/data"]);
    mkdirSync(join(branchDir, ".vibecompact"), { recursive: true });
    writeFileSync(
      join(branchDir, ".vibecompact", "ledger.jsonl"),
      JSON.stringify({
        id: makeUlid(),
        at: "2026-05-01T12:00:00Z",
        kind: "firing",
        fingerprint: "size:src/hot.ts",
        score: 2,
        threshold: 1,
      }) + "\n",
    );
    const entry: TrendEntry = {
      at: "2026-05-01T12:00:00Z",
      sha: auditedSha,
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
    appendTrendEntry(branchDir, entry);
    repo.git(branchDir, ["add", "-A"]);
    repo.git(branchDir, ["commit", "-q", "--no-verify", "-m", "data"], {
      GIT_AUTHOR_DATE: "2026-05-01T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-05-01T12:00:00Z",
    });
    repo.git(branchDir, ["push", "-q", "origin", "vibecompact/data"]);
    repo.git(repo.work, ["worktree", "remove", "--force", branchDir]);

    // Branch reads work from the main worktree.
    expect(readDataBranchLedger(repo.work)).toHaveLength(1);
    expect(
      mergeDataBranchTrends(repo.work, []).map((e) => e.sha),
    ).toEqual([auditedSha]);

    // A small commit touching the (branch-recorded) firing file →
    // fix-confirmation, even though main carries no machine state.
    repo.commit(
      "attempt a fix",
      { "src/hot.ts": "export const hot = 2;\n" },
      "2026-05-02T12:00:00Z",
    );
    const decision = evaluateGate(repo.work, DEFAULT_AUDIT_CONFIG);
    expect(decision).toMatchObject({ active: true, reason: "fix-confirmation" });
  });

  it("writeUnionLedger merges branch-only events before a data commit", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecompact-union-"));
    cleanups.push(root);
    const local = {
      id: makeUlid(),
      at: "2026-05-01T12:00:00Z",
      kind: "firing" as const,
      fingerprint: "size:a.ts",
      score: 2,
      threshold: 1,
    };
    mkdirSync(join(root, ".vibecompact"), { recursive: true });
    writeFileSync(
      join(root, ".vibecompact", "ledger.jsonl"),
      JSON.stringify(local) + "\n",
    );
    const branchOnly = {
      id: makeUlid(),
      at: "2026-05-02T12:00:00Z",
      verdict: "fixed" as const,
      fingerprint: "size:a.ts",
      score: 0.1,
      threshold: 1,
    };
    // Union with the branch-only event, plus a duplicate of local.
    const total = writeUnionLedger(root, [branchOnly, { ...local }]);
    expect(total).toBe(2);
  });
});

describe("emitted skill", () => {
  it("embeds resolved facts instead of hand-typed ones", () => {
    const skill = renderSkill("node /resolved/path/bin/cli.js");
    expect(skill).toContain("node /resolved/path/bin/cli.js audit");
    // Lane list from LANE_ANCHORS, not prose.
    expect(skill).toContain("`arrival`, `consistency`, `deadcode`");
    // Constants from the ledger module.
    expect(skill).toMatch(/3 distinct noise/);
    expect(skill).toMatch(/180\s*\n?\s*days/);
    // Trust boundary + batch-confirmation contract present.
    expect(skill).toContain("not instructions");
    expect(skill).toContain("do not file verdicts one-by-one");
    // Episodic-PR contract: close when triaged, never merge, and a
    // missing findings PR reads as healthy.
    expect(skill).toMatch(/close it when the batch is triaged/i);
    expect(skill).toMatch(/no open findings PR is healthy/);
    expect(skill).not.toMatch(/intentionally\s+never merged/);
  });
});
