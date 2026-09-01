import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_AUDIT_CONFIG, resolveAuditConfig } from "../src/audit/config.js";
import { detectEntryPoints } from "../src/audit/entrypoints.js";
import {
  extractNestedSymbols,
  extractSymbolMap,
  measureExtent,
} from "../src/audit/evidence.js";
import {
  buildDuplicationLane,
  countCodeLinesInSpan,
} from "../src/audit/lanes/duplication.js";
import { isToolingConfig } from "../src/audit/lanes/arrival.js";
import { buildDeadcodeLane } from "../src/audit/lanes/deadcode.js";
import {
  dependenciesInstalled,
  expandSolutionTsconfig,
} from "../src/audit/runners/type-coverage.js";
import { isUnpackingThrowaway } from "../src/audit/runners/vulture.js";
import type { JscpdResult } from "../src/audit/runners/jscpd.js";
import type { KnipResult } from "../src/audit/runners/knip.js";
import type { VultureResult } from "../src/audit/runners/vulture.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vibecheck-det-"));
  cleanups.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

describe("#380 — top-level spans stop at the real extent", () => {
  it("does not attribute route registrations to the preceding function", () => {
    // The hadoku-jobplatform shape: a small helper followed by large
    // top-level app.openapi(...) blocks. `idFrom` was reported at 777
    // lines when it is 13.
    const root = makeRoot({
      "routes.ts": [
        "function idFrom(req: Request) {",
        '  return req.header("x-id")',
        "}",
        "",
        'router.post("/rotate", async (c) => {',
        "  const body = await c.req.json()",
        "  return c.json({ ok: true, body })",
        "})",
        "",
        "function tail() {",
        "  return 1",
        "}",
      ].join("\n"),
    });
    const byName = new Map(
      extractSymbolMap(root, "routes.ts").map((s) => [s.name, s]),
    );
    expect(byName.get("idFrom")?.lines).toBe(3);
    expect(byName.get("idFrom")?.end).toBe(3);
    expect(byName.get("tail")?.lines).toBe(3);
  });

  it("ends a braceless declaration at its own statement", () => {
    const root = makeRoot({
      "t.ts": ["type Alias = string;", "", "", "const x = 1;"].join("\n"),
    });
    const map = extractSymbolMap(root, "t.ts");
    expect(map.find((s) => s.name === "Alias")?.lines).toBe(1);
  });

  it("measures Python by indentation", () => {
    const lines = ["def outer():", "    a = 1", "    b = 2", "", "def next_one():"];
    expect(measureExtent(lines, 0, true)).toBe(2);
  });
});

describe("#386 — inner sections stop at their closing brace", () => {
  it("does not let the last function absorb the JSX return", () => {
    const root = makeRoot({
      "Comp.tsx": [
        "export function VodPlayer() {",
        "  function onScrubClick(e: MouseEvent) {",
        "    if (total <= 0) return",
        "  }",
        "  return (",
        '    <div className="player">',
        "      <video />",
        "    </div>",
        "  )",
        "}",
      ].join("\n"),
    });
    const outer = extractSymbolMap(root, "Comp.tsx")[0];
    const inner = extractNestedSymbols(root, "Comp.tsx", outer);
    expect(inner).toHaveLength(1);
    expect(inner[0].name).toBe("onScrubClick");
    expect(inner[0].lines).toBe(3);
  });
});

describe("#385 — Python registration idioms are not dead code", () => {
  it("drops tuple-unpacking throwaways", () => {
    expect(
      isUnpackingThrowaway(
        "unused variable 'finder'",
        "    for finder, module_name, is_pkg in pkgutil.iter_modules(__path__):",
      ),
    ).toBe(true);
    expect(
      isUnpackingThrowaway("unused variable 'b'", "a, b = compute()"),
    ).toBe(true);
    // A genuinely unused single binding is still reported.
    expect(
      isUnpackingThrowaway("unused variable 'orphan'", "orphan = compute()"),
    ).toBe(false);
  });

  it("exempts Python test files, where the fixtures live", () => {
    const vulture: VultureResult = {
      available: true,
      items: [
        { path: "server/tests/test_x.py", line: 22, confidence: 100, description: "unused variable 'pytestmark'" },
        { path: "server/app/live.py", line: 4, confidence: 90, description: "unused function 'orphan'" },
      ],
    };
    const noKnip: KnipResult = { available: false, unusedFiles: [], unusedExports: new Map() };
    const result = buildDeadcodeLane(
      noKnip,
      vulture,
      ["server/tests/test_x.py", "server/app/live.py"],
      new Map([["server/tests/test_x.py", 5], ["server/app/live.py", 2]]),
    );
    const byPath = new Map(result.entries.map((e) => [e.path, e]));
    expect(byPath.get("server/tests/test_x.py")?.deadItems).toBe(0);
    expect(byPath.get("server/app/live.py")?.deadItems).toBe(1);
    expect(result.disclosures.join(" ")).toMatch(/test files were skipped/);
  });
});

describe("#384 — tooling configs cannot have a reaching test", () => {
  it("recognises flat configs across the ecosystem", () => {
    for (const p of [
      "eslint.config.js",
      "worker/eslint.config.js",
      "vite.config.ts",
      "apps/ui/vitest.config.mts",
      "tailwind.config.cjs",
      ".eslintrc.json",
    ]) {
      expect(isToolingConfig(p)).toBe(true);
    }
    expect(isToolingConfig("src/config.ts")).toBe(false);
    expect(isToolingConfig("src/components/App.tsx")).toBe(false);
  });
});

describe("#381 — a repo can declare a convention-loaded entry point", () => {
  it("exempts declared globs and says where the exemption came from", () => {
    const root = makeRoot({
      "keyholder/workspace/hooks/identity-swap/handler.ts": "export const x = 1;\n",
      "src/orphan.ts": "export const y = 2;\n",
    });
    const files = [
      "keyholder/workspace/hooks/identity-swap/handler.ts",
      "src/orphan.ts",
    ];
    const { entries, sources } = detectEntryPoints(root, files, [
      "keyholder/**/hooks/**/*.ts",
    ]);
    expect(entries.has("keyholder/workspace/hooks/identity-swap/handler.ts")).toBe(true);
    expect(entries.has("src/orphan.ts")).toBe(false);
    expect(
      sources.get("keyholder/workspace/hooks/identity-swap/handler.ts"),
    ).toMatch(/declared in audit.entry_points/);
  });

  it("resolves the config key", () => {
    expect(resolveAuditConfig({ entry_points: ["./hooks/**/*.ts"] }).entryPoints).toEqual([
      "hooks/**/*.ts",
    ]);
    expect(DEFAULT_AUDIT_CONFIG.entryPoints).toEqual([]);
  });
});

describe("#387 — duplicated lines are counted on scc's basis", () => {
  it("discounts comments and blanks inside a clone span", () => {
    const lines = [
      "import { a } from 'a'",
      "/**",
      " * doc scaffolding",
      " */",
      "",
      "const x = 1",
    ];
    expect(countCodeLinesInSpan(lines, 1, 6)).toBe(2);
  });

  it("stops a comment-heavy clone from inflating the score", () => {
    const spec = [
      "import { test } from '@playwright/test'",
      "// ------------------------------------",
      "// scaffolding comment block",
      "// ------------------------------------",
      "const setup = 1",
    ].join("\n");
    const jscpd: JscpdResult = {
      available: true,
      clones: [
        { fileA: "a.spec.ts", startA: 1, endA: 5, fileB: "b.spec.ts", startB: 1, endB: 5, lines: 5 },
      ],
    };
    // A denominator large enough that the density is not clamped, so
    // the inflation is visible in the score the lane actually fires on.
    const codeLines = new Map([["a.spec.ts", 20]]);
    const raw = buildDuplicationLane(jscpd, ["a.spec.ts", "b.spec.ts"], codeLines);
    expect(raw.entries[0].duplicatedLines).toBe(5);

    const aware = buildDuplicationLane(
      jscpd,
      ["a.spec.ts", "b.spec.ts"],
      codeLines,
      () => spec,
    );
    expect(aware.entries[0].duplicatedLines).toBe(2);
    expect(aware.entries[0].score).toBeLessThan(raw.entries[0].score);
  });
});

describe("#378/#383 — the smells lane refuses to guess", () => {
  it("expands a solution-style root into its referenced projects", () => {
    const root = makeRoot({
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./apps/ui" }, { path: "./packages/shared" }],
      }),
      "apps/ui/tsconfig.json": "{}",
      "packages/shared/tsconfig.json": "{}",
    });
    const expanded = expandSolutionTsconfig(root);
    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toContain("apps/ui");
  });

  it("leaves a real project alone", () => {
    const root = makeRoot({ "tsconfig.json": JSON.stringify({ include: ["src"] }) });
    expect(expandSolutionTsconfig(root)).toEqual([root]);
  });

  it("refuses to measure a project whose dependencies are not installed", () => {
    const missing = makeRoot({
      "package.json": JSON.stringify({ dependencies: { react: "^18" } }),
      "tsconfig.json": "{}",
    });
    expect(dependenciesInstalled(missing)).toBe(false);

    const installed = makeRoot({
      "package.json": JSON.stringify({ dependencies: { react: "^18" } }),
      "node_modules/react/package.json": "{}",
    });
    expect(dependenciesInstalled(installed)).toBe(true);

    const noDeps = makeRoot({ "package.json": JSON.stringify({ name: "x" }) });
    expect(dependenciesInstalled(noDeps)).toBe(true);
  });
});
