import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildDeadcodeLane,
  classifyInternalUse,
  countDefinitions,
  KNIP_FILES_MUTE_SHARE,
  SINGLE_SOURCE_DEMOTION,
} from "../src/audit/lanes/deadcode.js";
import type { KnipResult } from "../src/audit/runners/knip.js";
import type { VultureResult } from "../src/audit/runners/vulture.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

const noKnip: KnipResult = {
  available: false,
  unusedFiles: [],
  unusedExports: new Map(),
};
const noVulture: VultureResult = { available: false, items: [] };

describe("countDefinitions", () => {
  it("counts exports for TS and defs/classes for Python", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecheck-defs-"));
    cleanups.push(root);
    const write = (rel: string, content: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    };
    write(
      "src/a.ts",
      "export const x = 1;\nexport function f() {}\nconst internal = 2;\nexport type T = number;\n",
    );
    write(
      "src/b.py",
      "class Foo:\n    def method(self):\n        pass\n\nasync def main():\n    pass\n",
    );
    write("README.md", "# not code\n");
    const counts = countDefinitions(root, ["src/a.ts", "src/b.py", "README.md"]);
    expect(counts.get("src/a.ts")).toBe(3);
    expect(counts.get("src/b.py")).toBe(3);
    expect(counts.has("README.md")).toBe(false);
  });
});

describe("buildDeadcodeLane", () => {
  it("scores knip unused files at 1.0 and export share otherwise", () => {
    const knip: KnipResult = {
      available: true,
      unusedFiles: ["src/orphan.ts"],
      unusedExports: new Map([
        [
          "src/partial.ts",
          [
            { name: "unusedA", line: 3, kind: "export" as const },
            { name: "UnusedType", line: 9, kind: "type" as const },
          ],
        ],
      ]),
    };
    const result = buildDeadcodeLane(
      knip,
      noVulture,
      ["src/orphan.ts", "src/partial.ts", "src/clean.ts"],
      new Map([
        ["src/orphan.ts", 3],
        ["src/partial.ts", 4],
        ["src/clean.ts", 5],
      ]),
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("src/orphan.ts")?.score).toBe(1);
    expect(byPath.get("src/orphan.ts")?.unusedFile).toBe(true);
    expect(byPath.get("src/partial.ts")?.score).toBeCloseTo(0.5);
    expect(byPath.get("src/clean.ts")?.score).toBe(0);
    // Clean files still carry applicable entries (the gate needs them).
    expect(result.entries).toHaveLength(3);
  });

  it("demotes single-source vulture findings", () => {
    const vulture: VultureResult = {
      available: true,
      items: [
        { path: "pkg/mod.py", line: 3, confidence: 60, description: "unused function 'a'" },
        { path: "pkg/mod.py", line: 9, confidence: 90, description: "unused class 'B'" },
      ],
    };
    const result = buildDeadcodeLane(
      noKnip,
      vulture,
      ["pkg/mod.py"],
      new Map([["pkg/mod.py", 4]]),
    );
    expect(result.entries[0].score).toBeCloseTo(SINGLE_SOURCE_DEMOTION * 0.5);
    expect(result.disclosures.join(" ")).toMatch(/single-source/);
  });

  it("mutes the whole-file signal when knip flags an implausible share", () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    const flagged = files.slice(0, 4); // 40% > KNIP_FILES_MUTE_SHARE
    const knip: KnipResult = {
      available: true,
      unusedFiles: flagged,
      unusedExports: new Map(),
    };
    const result = buildDeadcodeLane(
      knip,
      noVulture,
      files,
      new Map(files.map((f) => [f, 2])),
    );
    expect(KNIP_FILES_MUTE_SHARE).toBeLessThan(0.4);
    expect(result.filesSignalMuted).toBe(true);
    for (const entry of result.entries) {
      expect(entry.unusedFile).toBe(false);
      expect(entry.score).toBe(0);
    }
    expect(result.disclosures.join(" ")).toMatch(/implausible share/);
  });

  it("covers only languages whose tool ran, with disclosure for gaps", () => {
    const knip: KnipResult = {
      available: true,
      unusedFiles: [],
      unusedExports: new Map(),
    };
    const result = buildDeadcodeLane(
      knip,
      noVulture,
      ["src/a.ts", "pkg/b.py", "lib/c.rs"],
      new Map(),
    );
    expect(result.coverage).toEqual(["ts-js"]);
    expect(result.entries.map((e) => e.path)).toEqual(["src/a.ts"]);
    expect(result.disclosures.join(" ")).toMatch(/vulture unavailable/);
  });

  it("degrades entirely when no tool covers the repo", () => {
    const result = buildDeadcodeLane(noKnip, noVulture, ["lib/c.rs"], new Map());
    expect(result.available).toBe(false);
  });
});

describe("dead-export vs dead-symbol classification", () => {
  const source = [
    "export function storePhoto(x: number) {",   // 1: exported, used below
    "  return x;",
    "}",
    "export const ORPHAN_LIMIT = 3;",            // 4: exported, never used
    "export { helper };",                        // 5: re-export line only
    "function helper() {",
    "  return storePhoto(1);",                   // 7: internal use of storePhoto
    "}",
  ].join("\n");

  it("marks internally-used exports as un-export, unused as delete", () => {
    expect(classifyInternalUse(source, "storePhoto", 1)).toBe(true);
    expect(classifyInternalUse(source, "ORPHAN_LIMIT", 4)).toBe(false);
    // A bare `export { helper }` line is not a use, but the definition
    // and call are on other lines.
    expect(classifyInternalUse(source, "default", 1)).toBeUndefined();
  });

  it("threads the classification into lane entries", () => {
    const knip: KnipResult = {
      available: true,
      unusedFiles: [],
      unusedExports: new Map([
        [
          "src/photos.ts",
          [
            { name: "storePhoto", line: 1, kind: "export" },
            { name: "ORPHAN_LIMIT", line: 4, kind: "export" },
          ],
        ],
      ]),
    };
    const result = buildDeadcodeLane(
      knip,
      noVulture,
      ["src/photos.ts"],
      new Map([["src/photos.ts", 3]]),
      new Set(),
      (path) => (path === "src/photos.ts" ? source : null),
    );
    const detail = result.entries[0].deadDetail;
    expect(detail.find((d) => d.name === "storePhoto")?.internalUse).toBe(true);
    expect(detail.find((d) => d.name === "ORPHAN_LIMIT")?.internalUse).toBe(false);
  });
});
