import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildConsistencyLane,
  copyArtifactBase,
  findCycleMembers,
} from "../src/audit/lanes/consistency.js";
import type { ImportData } from "../src/audit/import-graph.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "vibecheck-consistency-"));
  cleanups.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

function importData(
  graph: Record<string, string[]> = {},
  packageImports: Record<string, string[]> = {},
): ImportData {
  return {
    graph: new Map(Object.entries(graph)),
    packageImports: new Map(Object.entries(packageImports)),
  };
}

describe("copyArtifactBase", () => {
  it("recognizes copy suffixes and rejects barrels", () => {
    expect(copyArtifactBase("utils_v2.ts")).toBe("utils");
    expect(copyArtifactBase("api-old.py")).toBe("api");
    expect(copyArtifactBase("handler.backup.ts")).toBe("handler");
    // Bare digits stay silent — oauth2/base64/vec3 are names, not copies.
    expect(copyArtifactBase("routes2.ts")).toBeNull();
    expect(copyArtifactBase("oauth2.ts")).toBeNull();
    expect(copyArtifactBase("utils.ts")).toBeNull();
    expect(copyArtifactBase("index.ts")).toBeNull();
    expect(copyArtifactBase("__init__.py")).toBeNull();
    expect(copyArtifactBase("main.rs")).toBeNull();
  });
});

describe("findCycleMembers", () => {
  it("finds only true cycles, sized", () => {
    const members = findCycleMembers(
      new Map([
        ["a.ts", ["b.ts"]],
        ["b.ts", ["c.ts"]],
        ["c.ts", ["a.ts"]],
        ["d.ts", ["a.ts"]],
        ["e.ts", []],
      ]),
    );
    expect(members.get("a.ts")).toBe(3);
    expect(members.get("b.ts")).toBe(3);
    expect(members.get("c.ts")).toBe(3);
    expect(members.has("d.ts")).toBe(false);
    expect(members.has("e.ts")).toBe(false);
  });
});

describe("buildConsistencyLane", () => {
  it("fires copy artifacts only when the unsuffixed sibling coexists", () => {
    const root = makeRoot();
    const result = buildConsistencyLane(
      root,
      ["src/utils.ts", "src/utils_v2.ts", "src/api_v2.ts"],
      importData({ "src/utils.ts": [], "src/utils_v2.ts": [], "src/api_v2.ts": [] }),
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("src/utils_v2.ts")?.copyArtifactOf).toBe("src/utils.ts");
    expect(byPath.get("src/utils_v2.ts")?.score).toBe(1);
    // Lone api_v2 has no sibling — never fires (design rule).
    expect(byPath.get("src/api_v2.ts")?.copyArtifactOf).toBeUndefined();
  });

  it("flags orphans but exempts entry conventions, tests, and package.json refs", () => {
    const root = makeRoot({
      "package.json": JSON.stringify({ main: "src/referenced.ts" }),
    });
    const files = [
      "package.json",
      "src/orphan.ts",
      "src/imported.ts",
      "src/index.ts",
      "bin/tool.ts",
      "src/referenced.ts",
      "tests/thing.test.ts",
    ];
    const graph: Record<string, string[]> = Object.fromEntries(
      files.filter((f) => f.endsWith(".ts")).map((f) => [f, []]),
    );
    graph["src/index.ts"] = ["src/imported.ts"];
    const result = buildConsistencyLane(root, files, importData(graph));
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("src/orphan.ts")?.orphan).toBe(true);
    expect(byPath.get("src/orphan.ts")?.score).toBeCloseTo(0.8);
    expect(byPath.get("src/imported.ts")?.orphan).toBeUndefined();
    expect(byPath.get("src/index.ts")?.orphan).toBeUndefined();
    expect(byPath.get("bin/tool.ts")?.orphan).toBeUndefined();
    expect(byPath.get("src/referenced.ts")?.orphan).toBeUndefined();
    // Test files never enter the lane at all.
    expect(byPath.has("tests/thing.test.ts")).toBe(false);
  });

  it("scores cycle members below the firing anchor", () => {
    const root = makeRoot();
    const result = buildConsistencyLane(
      root,
      ["src/a.ts", "src/b.ts"],
      importData({ "src/a.ts": ["src/b.ts"], "src/b.ts": ["src/a.ts"] }),
    );
    const a = result.entries.find((e) => e.path === "src/a.ts");
    expect(a?.cycleSize).toBe(2);
    expect(a?.score).toBeCloseTo(0.5);
  });

  it("builds the category table and flags minority-provider import sites", () => {
    const root = makeRoot();
    const result = buildConsistencyLane(
      root,
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      importData(
        // a imports c so c is not an orphan — this test isolates the
        // minority-provider signal.
        { "src/a.ts": ["src/c.ts"], "src/b.ts": [], "src/c.ts": [] },
        {
          "src/a.ts": ["axios"],
          "src/b.ts": ["axios"],
          "src/c.ts": ["got"],
        },
      ),
    );
    expect(result.categoryFindings).toHaveLength(1);
    expect(result.categoryFindings[0]).toMatchObject({
      category: "http-client",
      majority: "axios",
      providers: { axios: 2, got: 1 },
    });
    const c = result.entries.find((e) => e.path === "src/c.ts");
    expect(c?.minorityOf).toBe("http-client: got vs axios");
    expect(c?.score).toBeCloseTo(0.7);
    // Majority users carry no per-file flag.
    expect(
      result.entries.find((e) => e.path === "src/a.ts")?.minorityOf,
    ).toBeUndefined();
  });

  it("keeps single-provider categories out of the table", () => {
    const root = makeRoot();
    const result = buildConsistencyLane(
      root,
      ["src/a.ts"],
      importData({ "src/a.ts": [] }, { "src/a.ts": ["axios"] }),
    );
    expect(result.categoryFindings).toEqual([]);
  });

  it("scopes categories per package (across packages = no per-file flag)", () => {
    const root = makeRoot({
      "packages/x/package.json": "{}",
      "packages/y/package.json": "{}",
    });
    const result = buildConsistencyLane(
      root,
      [
        "packages/x/package.json",
        "packages/y/package.json",
        "packages/x/src/a.ts",
        "packages/y/src/b.ts",
      ],
      importData(
        { "packages/x/src/a.ts": [], "packages/y/src/b.ts": [] },
        {
          "packages/x/src/a.ts": ["axios"],
          "packages/y/src/b.ts": ["got"],
        },
      ),
    );
    // Different packages, one provider each: no finding, no flags.
    expect(result.categoryFindings).toEqual([]);
    for (const entry of result.entries) {
      expect(entry.minorityOf).toBeUndefined();
    }
  });
});
