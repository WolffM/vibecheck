import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectGitHistory } from "../src/audit/git-arrival.js";
import {
  buildImportGraph,
  extractImportSpecifiers,
  resolveSpecifier,
} from "../src/audit/import-graph.js";
import {
  buildTestReachability,
  isSnapshotFile,
  runArrivalLane,
} from "../src/audit/lanes/arrival.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

interface FixtureRepo {
  root: string;
  commit: (message: string, files: Record<string, string>) => void;
  tracked: () => string[];
}

function makeRepo(prefix: string): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(root);
  const git = (args: string[], env: Record<string, string> = {}) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: "ignore",
      env: { ...process.env, ...env },
    });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  let index = 0;
  return {
    root,
    commit(message, files) {
      for (const [rel, content] of Object.entries(files)) {
        const abs = join(root, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
      git(["add", "-A"]);
      const date = `2026-02-${String(++index).padStart(2, "0")}T12:00:00Z`;
      git(["commit", "-q", "--no-verify", "-m", message], {
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      });
    },
    tracked: () =>
      execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf-8" })
        .split("\0")
        .filter(Boolean),
  };
}

describe("import graph primitives", () => {
  it("extracts static, dynamic, side-effect, and require imports", () => {
    const source = `
      import { a } from "./a.js";
      import "./side-effect";
      export { b } from "../b";
      const c = await import("./c");
      const d = require("./d");
      import pkg from "some-package";
    `;
    expect(extractImportSpecifiers(source).sort()).toEqual([
      "../b",
      "./a.js",
      "./c",
      "./d",
      "./side-effect",
      "some-package",
    ]);
  });

  it("resolves relative specifiers with extension and index fallbacks", () => {
    const candidates = new Set([
      "src/a.ts",
      "src/lib/index.ts",
      "src/b/util.tsx",
    ]);
    expect(resolveSpecifier("src/x.ts", "./a.js", candidates)).toBe("src/a.ts");
    expect(resolveSpecifier("src/x.ts", "./a", candidates)).toBe("src/a.ts");
    expect(resolveSpecifier("src/x.ts", "./lib", candidates)).toBe(
      "src/lib/index.ts",
    );
    expect(resolveSpecifier("src/x.ts", "./b/util", candidates)).toBe(
      "src/b/util.tsx",
    );
    expect(resolveSpecifier("src/x.ts", "lodash", candidates)).toBeNull();
    expect(resolveSpecifier("src/x.ts", "./missing", candidates)).toBeNull();
  });
});

describe("isSnapshotFile", () => {
  it("classifies snapshot and golden paths", () => {
    expect(isSnapshotFile("tests/__snapshots__/a.test.ts.snap")).toBe(true);
    expect(isSnapshotFile("pkg/testdata/case1.json")).toBe(true);
    expect(isSnapshotFile("golden/output.txt")).toBe(true);
    expect(isSnapshotFile("src/app.ts")).toBe(false);
  });
});

describe("arrival lane — graph join", () => {
  it("scores an untested file high and a graph-covered file low", () => {
    const repo = makeRepo("vibecheck-arr-graph-");
    const coveredTest = "import { covered } from '../src/covered.js';\n";
    repo.commit("initial", {
      "src/covered.ts": "export const covered = 0;\n",
      "src/naked.ts": "export const naked = 0;\n",
      "src/wrongly-tested.ts": "export const wrong = 0;\n",
      "tests/covered.test.ts": coveredTest,
    });
    for (let round = 1; round <= 3; round++) {
      // covered.ts always moves together with its reaching test.
      repo.commit(`grow covered ${round}`, {
        "src/covered.ts": `export const covered = ${round};\n`,
        "tests/covered.test.ts": coveredTest + `// round ${round}\n`,
      });
      // naked.ts never moves with any test.
      repo.commit(`grow naked ${round}`, {
        "src/naked.ts": `export const naked = ${round};\n`,
      });
      // wrongly-tested.ts moves with a test that does not import it.
      repo.commit(`grow wrong ${round}`, {
        "src/wrongly-tested.ts": `export const wrong = ${round};\n`,
        "tests/covered.test.ts": coveredTest + `// wrong round ${round}\n`,
      });
    }

    const history = collectGitHistory(repo.root);
    expect(history).not.toBeNull();
    const result = runArrivalLane(repo.root, history, repo.tracked());
    const byPath = new Map(result.entries.map((e) => [e.path, e]));

    const naked = byPath.get("src/naked.ts");
    expect(naked?.applicable).toBe(true);
    expect(naked?.coChangeMode).toBe("graph");
    expect(naked?.untestedShare).toBe(1);
    expect(naked?.score).toBeGreaterThanOrEqual(1);

    const covered = byPath.get("src/covered.ts");
    // Only the initial commit lacked the test co-change.
    expect(covered?.untestedShare).toBeLessThanOrEqual(0.25);

    // Commit granularity would call this covered; the graph join does not.
    const wrong = byPath.get("src/wrongly-tested.ts");
    expect(wrong?.untestedShare).toBe(1);

    // Test files themselves never become lane entries.
    expect(byPath.has("tests/covered.test.ts")).toBe(false);
  });

  it("builds reachability only from test files", () => {
    const repo = makeRepo("vibecheck-arr-reach-");
    repo.commit("initial", {
      "src/a.ts": "import { b } from './b.js';\nexport const a = b;\n",
      "src/b.ts": "export const b = 1;\n",
      "tests/a.test.ts": "import { a } from '../src/a.js';\n",
    });
    const reach = buildTestReachability(
      buildImportGraph(repo.root, repo.tracked()),
    );
    expect([...reach.keys()]).toEqual(["tests/a.test.ts"]);
    // Transitive: the test reaches b through a.
    expect(reach.get("tests/a.test.ts")).toEqual(
      new Set(["src/a.ts", "src/b.ts"]),
    );
  });
});

describe("arrival lane — squash mute", () => {
  it("mutes bulk arrival on uniform squash history and discloses it", () => {
    const repo = makeRepo("vibecheck-arr-squash-");
    const body = (n: number) =>
      Array.from({ length: 40 }, (_, i) => `export const v${n}_${i} = ${i};`).join(
        "\n",
      ) + "\n";
    repo.commit("initial (#1)", { "src/mod0.ts": body(0) });
    for (let n = 1; n <= 6; n++) {
      repo.commit(`feat: squash-merged change (#${n + 1})`, {
        [`src/mod${n}.ts`]: body(n),
      });
    }

    const history = collectGitHistory(repo.root);
    expect(history?.workflowShape.squashDominant).toBe(true);
    const result = runArrivalLane(repo.root, history, repo.tracked());
    expect(result.bulkMuted).toBe(true);
    expect(result.disclosures.join(" ")).toMatch(/bulk arrival muted/);
    for (const entry of result.entries) {
      expect(entry.bulkScore).toBe(0);
    }
  });

  it("keeps bulk arrival live on varied non-squash history", () => {
    const repo = makeRepo("vibecheck-arr-varied-");
    repo.commit("initial", { "src/steady.ts": "export const s = 0;\n" });
    repo.commit("small tweak", { "src/steady.ts": "export const s = 1;\n" });
    repo.commit("another tweak", { "src/steady.ts": "export const s = 2;\n" });
    const dump =
      Array.from({ length: 200 }, (_, i) => `export const d${i} = ${i};`).join(
        "\n",
      ) + "\n";
    repo.commit("huge dump", { "src/dumped.ts": dump });
    repo.commit("dump tweak", { "src/dumped.ts": dump + "export const z = 1;\n" });
    repo.commit("dump tweak 2", {
      "src/dumped.ts": dump + "export const z = 2;\n",
    });

    const history = collectGitHistory(repo.root);
    const result = runArrivalLane(repo.root, history, repo.tracked());
    expect(result.bulkMuted).toBe(false);
    const dumped = result.entries.find((e) => e.path === "src/dumped.ts");
    expect(dumped?.bulkScore).toBeGreaterThan(10);
  });
});

describe("arrival lane — degradation", () => {
  it("soft-skips with disclosure outside a git repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "vibecheck-arr-nogit-"));
    cleanups.push(plain);
    const result = runArrivalLane(plain, null, []);
    expect(result.available).toBe(false);
    expect(result.disclosures.join(" ")).toMatch(/no git history/);
  });

  it("abstains for a language family with no test infrastructure", () => {
    // Python side has tests; the TS/JS subtree has none at all. "No
    // reaching test" is then a repo-level fact about the subtree, not a
    // per-file finding on whichever files happened to churn.
    const repo = makeRepo("vibecheck-arr-notests-");
    repo.commit("initial", {
      "frontend/src/App.tsx": "export const a = 0;\n",
      "api/server.py": "x = 0\n",
      "tests/test_api.py": "def test_x():\n    pass\n",
    });
    for (let round = 1; round <= 3; round++) {
      repo.commit(`grow ${round}`, {
        "frontend/src/App.tsx": `export const a = ${round};\n`,
        "api/server.py": `x = ${round}\n`,
      });
    }
    const history = collectGitHistory(repo.root);
    const result = runArrivalLane(repo.root, history, repo.tracked());

    const app = result.entries.find((e) => e.path === "frontend/src/App.tsx");
    expect(app?.applicable).toBe(false);
    expect(app?.score).toBe(0);
    const server = result.entries.find((e) => e.path === "api/server.py");
    expect(server?.applicable).toBe(true);
    const note = result.disclosures.find((d) =>
      d.includes("no test files exist anywhere"),
    );
    expect(note).toContain("TS/JS");
    expect(note).toContain("repo-level fact");
  });
});
