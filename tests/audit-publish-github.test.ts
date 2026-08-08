import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyRunFooter,
  AUDIT_DATA_BRANCH,
  AUDIT_ISSUE_MARKER,
  AUDIT_PR_MARKER,
  commitDataFiles,
  publishLivingIssue,
  pushDataBranch,
  stageRunArtifact,
  upsertDataPr,
  type IssueClient,
} from "../src/audit/publish/github.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function fakeClient(
  existing: { number: number; body: string | null }[],
  openPulls: { number: number }[] = [],
) {
  const calls: Record<string, unknown[]> = {
    create: [],
    update: [],
    label: [],
    addLabels: [],
    createPull: [],
    updatePull: [],
  };
  const client: IssueClient = {
    async listIssues() {
      return existing;
    },
    async createIssue(params) {
      calls.create.push(params);
      return { number: 77 };
    },
    async updateIssue(params) {
      calls.update.push(params);
    },
    async ensureLabel(params) {
      calls.label.push(params);
    },
    async addLabels(params) {
      calls.addLabels.push(params);
    },
    async listPulls() {
      return openPulls;
    },
    async createPull(params) {
      calls.createPull.push(params);
      return { number: 42 };
    },
    async updatePull(params) {
      calls.updatePull.push(params);
    },
  };
  return { client, calls };
}

describe("publishLivingIssue", () => {
  it("creates the issue (with label) when none exists", async () => {
    const { client, calls } = fakeClient([]);
    const result = await publishLivingIssue(client, "o", "r", "# report");
    expect(result).toEqual({ issueNumber: 77, created: true });
    expect(calls.create).toHaveLength(1);
    expect(calls.label).toHaveLength(1);
    const body = (calls.create[0] as { body: string }).body;
    expect(body.startsWith(AUDIT_ISSUE_MARKER)).toBe(true);
  });

  it("edits the marked issue in place and ignores unmarked ones", async () => {
    const { client, calls } = fakeClient([
      { number: 5, body: "unrelated issue that shares the label" },
      { number: 9, body: `${AUDIT_ISSUE_MARKER}\n\nold report` },
    ]);
    const result = await publishLivingIssue(client, "o", "r", "# new report");
    expect(result).toEqual({ issueNumber: 9, created: false });
    expect(calls.create).toHaveLength(0);
    expect(
      (calls.update[0] as { issue_number: number }).issue_number,
    ).toBe(9);
  });

  it("appends the apply-run footer when provided", async () => {
    const { client, calls } = fakeClient([]);
    await publishLivingIssue(client, "o", "r", "# report", applyRunFooter("42"));
    const body = (calls.create[0] as { body: string }).body;
    expect(body).toContain("vibecheck apply-run 42");
  });
});

interface FixturePair {
  work: string;
  origin: string;
  git: (cwd: string, args: string[]) => string;
}

function makeClonePair(prefix: string): FixturePair {
  const base = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(base);
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  const git = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, work]);
  git(work, ["config", "user.email", "test@example.com"]);
  git(work, ["config", "user.name", "Test"]);
  writeFileSync(join(work, "README.md"), "seed\n");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-q", "-m", "seed"]);
  git(work, ["push", "-q", "origin", "main"]);
  return { work, origin, git };
}

function writeDataFiles(root: string, tag: string): void {
  mkdirSync(join(root, ".vibecompact"), { recursive: true });
  writeFileSync(
    join(root, ".vibecompact", "ledger.jsonl"),
    `{"id":"01TEST${tag}","at":"2026-08-05T00:00:00Z","kind":"firing","fingerprint":"size:a.ts","score":1,"threshold":1}\n`,
  );
  writeFileSync(join(root, ".vibecompact", "trends.json"), `[{"tag":"${tag}"}]\n`);
}

describe("commitDataFiles", () => {
  it("commits and pushes on the happy path", () => {
    const { work, git } = makeClonePair("vibecheck-push-");
    writeDataFiles(work, "A");
    const result = commitDataFiles(work, { branch: "main" });
    expect(result).toEqual({ committed: true, pushed: true, attempts: 1 });
    expect(git(work, ["log", "-1", "--format=%s"])).toBe(
      "vibecheck: audit data files [skip ci]",
    );
  });

  it("is a no-op when the data files have not changed", () => {
    const { work } = makeClonePair("vibecheck-noop-");
    writeDataFiles(work, "A");
    commitDataFiles(work, { branch: "main" });
    const again = commitDataFiles(work, { branch: "main" });
    expect(again).toEqual({ committed: false, pushed: true, attempts: 0 });
  });

  it("fetch-rebase-retries past a concurrent remote commit", () => {
    const pair = makeClonePair("vibecheck-race-");
    // A second clone lands a commit the first knows nothing about.
    const other = join(pair.work, "..", "other");
    execFileSync("git", ["clone", "-q", pair.origin, other]);
    pair.git(other, ["config", "user.email", "other@example.com"]);
    pair.git(other, ["config", "user.name", "Other"]);
    writeFileSync(join(other, "file.txt"), "concurrent\n");
    pair.git(other, ["add", "-A"]);
    pair.git(other, ["commit", "-q", "-m", "concurrent work"]);
    pair.git(other, ["push", "-q", "origin", "main"]);

    writeDataFiles(pair.work, "B");
    const result = commitDataFiles(pair.work, { branch: "main" });
    expect(result.pushed).toBe(true);
    expect(result.attempts).toBe(2);
    // Both commits present on origin.
    const log = pair.git(pair.work, ["log", "--oneline", "origin/main"]);
    expect(log).toContain("audit data files");
    expect(log).toContain("concurrent work");
  });

  it("returns pushed:false against branch protection (pre-receive reject)", () => {
    const pair = makeClonePair("vibecheck-protected-");
    const hook = join(pair.origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho 'protected' >&2\nexit 1\n");
    execFileSync("chmod", ["+x", hook]);

    writeDataFiles(pair.work, "C");
    const result = commitDataFiles(pair.work, { branch: "main", retries: 2 });
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
  });
});

describe("stageRunArtifact", () => {
  it("copies the ledger into the run's events file", () => {
    const { work } = makeClonePair("vibecheck-artifact-");
    writeDataFiles(work, "D");
    const path = stageRunArtifact(work, "12345");
    expect(path).toBe(join(work, ".vibecompact", "runs", "12345.jsonl"));
    expect(readFileSync(path, "utf-8")).toContain("01TESTD");
  });
});

describe("living data PR (delivery ladder rung two)", () => {
  it("creates the PR when none is open, with the marker and merge note", async () => {
    const { client, calls } = fakeClient([]);
    const result = await upsertDataPr(client, "o", "r", "main", "Run 1: updated.");
    expect(result).toEqual({ prNumber: 42, created: true });
    const params = calls.createPull[0] as { head: string; base: string; body: string };
    expect(params.head).toBe(AUDIT_DATA_BRANCH);
    expect(params.base).toBe("main");
    expect(params.body).toContain(AUDIT_PR_MARKER);
    expect(params.body).toContain("required status checks");
  });

  it("refreshes the existing PR instead of opening another", async () => {
    const { client, calls } = fakeClient([], [{ number: 9 }]);
    const result = await upsertDataPr(client, "o", "r", "main", "Run 2.");
    expect(result).toEqual({ prNumber: 9, created: false });
    expect(calls.createPull).toHaveLength(0);
    expect(
      (calls.updatePull[0] as { pull_number: number }).pull_number,
    ).toBe(9);
  });

  it("branch push clears a protection that rejects only the default branch", () => {
    const pair = makeClonePair("vibecheck-ladder-");
    const hook = join(pair.origin, "hooks", "pre-receive");
    writeFileSync(
      hook,
      '#!/bin/sh\nwhile read old new ref; do\n  [ "$ref" = "refs/heads/main" ] && { echo protected >&2; exit 1; }\ndone\nexit 0\n',
    );
    execFileSync("chmod", ["+x", hook]);

    writeDataFiles(pair.work, "L");
    const result = commitDataFiles(pair.work, { branch: "main", retries: 2 });
    expect(result.pushed).toBe(false);
    // Rung two succeeds where rung one was rejected.
    expect(pushDataBranch(pair.work)).toBe(true);
    const branches = pair.git(pair.origin, ["branch"]);
    expect(branches).toContain(AUDIT_DATA_BRANCH.split("/")[1]);
  });
});
