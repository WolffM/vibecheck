import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  extractSymbolMap,
  largestSymbols,
  stringReferenceScan,
} from "../src/audit/evidence.js";
import { renderFindingPackages } from "../src/audit/findings.js";
import { fixtureResult } from "./helpers/audit-fixture.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vibecheck-ev-"));
  cleanups.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

describe("stringReferenceScan", () => {
  it("finds the loading mechanism for a falsely-orphaned file", () => {
    const root = makeRoot({
      "src/player.js": "export const play = () => {};\n",
      "src/index.html": '<script src="player.js"></script>\n',
      "src/other.ts": "const unrelated = 1;\n",
    });
    const refs = stringReferenceScan(
      root,
      ["src/player.js", "src/index.html", "src/other.ts"],
      ["src/player.js"],
    );
    expect(refs.get("src/player.js")).toEqual([
      {
        file: "src/index.html",
        line: 1,
        text: '<script src="player.js"></script>',
      },
    ]);
  });

  it("reports clean when nothing references the target", () => {
    const root = makeRoot({
      "src/lonely.ts": "export const x = 1;\n",
      "src/other.ts": "const y = 2;\n",
    });
    const refs = stringReferenceScan(
      root,
      ["src/lonely.ts", "src/other.ts"],
      ["src/lonely.ts"],
    );
    expect(refs.get("src/lonely.ts")).toEqual([]);
  });
});

describe("extractSymbolMap", () => {
  it("maps top-level TS symbols with spans", () => {
    const root = makeRoot({
      "src/big.ts": [
        "export function alpha() {",
        "  return 1;",
        "}",
        "",
        "const helper = 1;",
        "",
        "export class Beta {",
        "  method() {}",
        "}",
      ].join("\n"),
    });
    const symbols = extractSymbolMap(root, "src/big.ts");
    expect(symbols.map((s) => [s.name, s.start, s.end])).toEqual([
      ["alpha", 1, 4],
      ["helper", 5, 6],
      ["Beta", 7, 9],
    ]);
  });

  it("ignores nested definitions and ranks by size", () => {
    const root = makeRoot({
      "src/mod.py": [
        "def big():",
        ...Array.from({ length: 30 }, (_, i) => `    x${i} = ${i}`),
        "",
        "def small():",
        "    pass",
      ].join("\n"),
    });
    const symbols = extractSymbolMap(root, "src/mod.py");
    expect(symbols.map((s) => s.name)).toEqual(["big", "small"]);
    const top = largestSymbols(symbols);
    expect(top[0].name).toBe("big");
    expect(top[0].lines).toBeGreaterThan(25);
  });
});

describe("renderFindingPackages", () => {
  it("emits an evidence package per offender with actionable detail", () => {
    const result = fixtureResult(makeRoot({
      "src/dumped.ts":
        "export function huge() {\n" +
        Array.from({ length: 40 }, (_, i) => `  const v${i} = ${i};`).join("\n") +
        "\n}\nexport function tiny() { return 1; }\n",
    }));
    const packages = renderFindingPackages(result);
    expect([...packages.keys()]).toContain("src__dumped.ts.md");
    const pkg = packages.get("src__dumped.ts.md") as string;
    expect(pkg).toContain("Corroborated finding, rank 1");
    // `huge` IS the file — extract-it-whole would be a no-op, so the
    // advice must point inside the symbol instead.
    expect(pkg).toContain("`huge`");
    expect(pkg).toContain("moving it to its own module would relocate the problem");
    expect(pkg).not.toContain("Suggested first cut: extract `huge`");
    // Verdict commands attached.
    expect(pkg).toContain('vibecheck wontfix|noise|justify "size:src/dumped.ts"');
  });

  it("suggests extracting the largest symbol when no symbol dominates", () => {
    const block = (name: string) =>
      `export function ${name}() {\n` +
      Array.from({ length: 15 }, (_, i) => `  const v${i} = ${i};`).join("\n") +
      "\n}\n";
    const result = fixtureResult(
      makeRoot({
        "src/dumped.ts": block("alpha") + block("beta") + block("gamma"),
      }),
    );
    const pkg = renderFindingPackages(result).get("src__dumped.ts.md") as string;
    expect(pkg).toContain("Suggested first cut: extract `alpha`");
  });

  it("lists the sections inside a dominant symbol as the cut points", () => {
    const inner = (name: string) =>
      `    def ${name}():\n` +
      Array.from({ length: 12 }, (_, i) => `        y${i} = ${i}`).join("\n") +
      "\n";
    const result = fixtureResult(
      makeRoot({
        "src/dumped.ts": "", // path must exist for the size entry lookup
        "src/mono.py":
          "def build_app():\n" + inner("routes_a") + inner("routes_b") + inner("routes_c"),
      }),
    );
    result.lanes.size?.entries.push({
      path: "src/mono.py",
      language: "Python",
      codeLines: 40,
      complexity: 3,
      tier: 1,
      score: 1.1,
      cohesionModifier: 1,
    });
    result.worstOffenders.push({
      path: "src/mono.py",
      applicableLanes: ["size"],
      firingLanes: [{ lane: "size", score: 1.1, threshold: 1 }],
      suppressedByFloor: [],
      weightedScore: 2.3,
      gatePassed: false,
    });
    const pkg = renderFindingPackages(result).get("src__mono.py.md") as string;
    expect(pkg).toContain("section inside `build_app`");
    expect(pkg).toContain("`routes_a`");
    expect(pkg).toContain("group these 3 inner sections by responsibility");
  });

  it("gives deletion candidates a verification result, not an instruction", () => {
    const root = makeRoot({
      "src/lonely.ts": "export const x = 1;\n",
    });
    const result = fixtureResult(root);
    result.candidateFiles = ["src/lonely.ts"];
    result.lanes.consistency = {
      lane: "consistency",
      available: true,
      disclosures: [],
      categoryFindings: [],
      entries: [
        { path: "src/lonely.ts", applicable: true, orphan: true, score: 0.8 },
      ],
    };
    const packages = renderFindingPackages(result);
    const pkg = packages.get("DELETE__src__lonely.ts.md") as string;
    expect(pkg).toContain("String-reference scan: **clean**");
    expect(pkg).toContain("Delete the file");
  });
});
