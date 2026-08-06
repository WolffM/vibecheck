import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildFileHistories,
  collectGitHistory,
  detectWorkflowShape,
  isTestFile,
  serializeHistory,
  type GitHistory,
} from "../src/audit/git-arrival.js";

let repo: string;

function git(args: string[], env: Record<string, string> = {}): void {
  execFileSync("git", args, {
    cwd: repo,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
}

let commitIndex = 0;
function commit(message: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  git(["add", "-A"]);
  // Fixed, strictly increasing timestamps keep the fixture deterministic.
  const date = `2026-01-${String(++commitIndex).padStart(2, "0")}T12:00:00+00:00`;
  git(["commit", "-q", "--no-verify", "-m", message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "vibecheck-arrival-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);

  commit("initial layout", {
    "src/app.ts": "export const app = 1;\n",
    "src/util.ts": "export const util = 1;\n",
  });
  commit("feat: grow app (#12)", {
    "src/app.ts": "export const app = 1;\nexport const more = 2;\n",
  });
  commit("test app (#13)", {
    "src/app.ts": "export const app = 1;\nexport const more = 3;\n",
    "tests/app.test.ts": "import { app } from '../src/app';\n",
  });
  // A branch merged back in produces one merge commit.
  git(["checkout", "-q", "-b", "feature"]);
  commit("feature work", { "src/feature.ts": "export const f = 1;\n" });
  git(["checkout", "-q", "main"]);
  commit("mainline (#14)", { "src/util.ts": "export const util = 2;\n" });
  git(["merge", "-q", "--no-ff", "--no-edit", "feature"], {
    GIT_AUTHOR_DATE: "2026-01-20T12:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-20T12:00:00Z",
  });
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("isTestFile", () => {
  it("recognizes common test path conventions", () => {
    for (const path of [
      "tests/app.test.ts",
      "src/__tests__/x.ts",
      "src/app.spec.ts",
      "pkg/handler_test.go",
      "tests/test_module.py",
      "tests/conftest.py",
      "src/main/java/FooTest.java",
      "spec/models/user_spec.rb",
    ]) {
      expect(isTestFile(path), path).toBe(true);
    }
  });

  it("does not flag non-test paths", () => {
    for (const path of [
      "src/app.ts",
      "latest/index.ts",
      "test-fixtures/sample.ts",
      "src/contest.py",
      "protester.go",
    ]) {
      expect(isTestFile(path), path).toBe(false);
    }
  });
});

describe("collectGitHistory", () => {
  let history: GitHistory;
  beforeAll(() => {
    const collected = collectGitHistory(repo);
    if (!collected) throw new Error("fixture repo produced no history");
    history = collected;
  });

  it("anchors to HEAD's commit date, not wall clock", () => {
    expect(history.anchorDate).toBe("2026-01-20T12:00:00Z");
    expect(history.anchorSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("parses numstat into per-commit file changes", () => {
    const grow = history.commits.find((c) => c.subject === "feat: grow app (#12)");
    expect(grow?.files).toEqual([
      { path: "src/app.ts", added: 1, deleted: 0, binary: false },
    ]);
    const testCommit = history.commits.find(
      (c) => c.subject === "test app (#13)",
    );
    expect(testCommit?.testFiles).toEqual(["tests/app.test.ts"]);
  });

  it("flags merge commits and leaves them without numstat entries", () => {
    const merge = history.commits.find((c) => c.isMerge);
    expect(merge).toBeDefined();
    expect(merge?.files).toEqual([]);
  });

  it("classifies the fixture as a young repo", () => {
    expect(history.age.youngRepo).toBe(true);
    expect(history.age.commitCount).toBe(history.commits.length);
    expect(history.age.historyDays).toBe(19);
  });

  it("is byte-identical across repeated collection at the same SHA", () => {
    const again = collectGitHistory(repo);
    expect(again).not.toBeNull();
    expect(serializeHistory(again as GitHistory)).toBe(
      serializeHistory(history),
    );
  });

  it("returns null outside a git repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "vibecheck-nogit-"));
    try {
      expect(collectGitHistory(plain)).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("buildFileHistories", () => {
  it("collects per-file commit lists newest first", () => {
    const history = collectGitHistory(repo) as GitHistory;
    const perFile = buildFileHistories(history.commits);
    const app = perFile.get("src/app.ts");
    expect(app?.map((e) => e.date)).toEqual([
      "2026-01-03T12:00:00Z",
      "2026-01-02T12:00:00Z",
      "2026-01-01T12:00:00Z",
    ]);
    expect(perFile.get("tests/app.test.ts")).toHaveLength(1);
  });
});

describe("detectWorkflowShape", () => {
  function fakeCommit(subject: string, isMerge = false) {
    return {
      sha: "0".repeat(40),
      date: "2026-01-01T00:00:00+00:00",
      isMerge,
      subject,
      files: [],
      testFiles: [],
    };
  }

  it("detects squash-dominant history (no merges, PR suffixes)", () => {
    const commits = [
      ...Array.from({ length: 8 }, (_, i) => fakeCommit(`feat: x (#${i})`)),
      fakeCommit("chore: manual tweak"),
    ];
    const shape = detectWorkflowShape(commits);
    expect(shape.squashDominant).toBe(true);
    expect(shape.mergeShare).toBe(0);
  });

  it("does not flag merge-heavy history as squash", () => {
    const commits = [
      ...Array.from({ length: 5 }, () => fakeCommit("Merge pull request", true)),
      ...Array.from({ length: 5 }, (_, i) => fakeCommit(`fix ${i}`)),
    ];
    expect(detectWorkflowShape(commits).squashDominant).toBe(false);
  });

  it("handles empty history", () => {
    expect(detectWorkflowShape([]).squashDominant).toBe(false);
  });
});
