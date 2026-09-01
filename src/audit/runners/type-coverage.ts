/**
 * type-coverage runner (smells lane substrate, TS)
 *
 * Counts `any`-typed identifiers per file. Runs from the vibecheck
 * process's own module context (`npx type-coverage -p <target>`), because
 * type-coverage needs a resolvable `typescript` peer — standalone npx
 * sandboxes crash on it. Where that resolution fails the lane soft-skips
 * with disclosure.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describeRunFailure } from "./run-failure.js";

/**
 * type-coverage from THIS package's dependencies — never the npx cache.
 * The npx-cached copy cannot resolve its `typescript` peer from a pnpm
 * target repo, and a bare `npx` lookup depends on whatever cwd the CLI
 * happened to inherit. Resolved lazily so importing the module never
 * throws.
 */
function typeCoverageBin(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return join(
      require.resolve("type-coverage/package.json"),
      "..",
      "bin",
      "type-coverage",
    );
  } catch {
    return null;
  }
}

export interface TypeCoverageResult {
  available: boolean;
  /** any-typed identifier count per repo-relative file. */
  anyCounts: Map<string, number>;
  /** Overall covered/total from the summary line, when present. */
  percent: number | null;
  /** Why a project was skipped — never degrade the lane silently. */
  disclosures?: string[];
}

/**
 * Runs once per JS project root that carries a tsconfig.json (see
 * roots.ts) — a repo whose TS app lives in a subdirectory has no root
 * tsconfig to probe. Paths in the result are always repo-relative; the
 * percent is aggregated over all roots from the covered/total counts.
 */
/**
 * A solution-style tsconfig (`{"files": [], "references": [...]}`) is the
 * idiomatic TypeScript monorepo root: a manifest, not a project. It
 * legitimately matches zero files, so running type-coverage against it
 * returns `0 / 0` and the whole repo silently loses the lane (#378).
 * Expand it into the projects it references instead.
 */
export function expandSolutionTsconfig(projectPath: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(join(projectPath, "tsconfig.json"), "utf-8");
  } catch {
    return [projectPath];
  }
  let parsed: { files?: unknown[]; include?: unknown[]; references?: { path?: string }[] };
  try {
    // tsconfig allows comments and trailing commas; strip conservatively.
    parsed = JSON.parse(
      raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1")
        .replace(/,(\s*[}\]])/g, "$1"),
    );
  } catch {
    return [projectPath];
  }
  const references = parsed.references ?? [];
  const hasNoOwnSources =
    Array.isArray(parsed.files) &&
    parsed.files.length === 0 &&
    (parsed.include === undefined ||
      (Array.isArray(parsed.include) && parsed.include.length === 0));
  if (references.length === 0 || !hasNoOwnSources) return [projectPath];
  const expanded = references
    .map((r) => r.path)
    .filter((x): x is string => typeof x === "string")
    .map((r) => resolve(projectPath, r.replace(/\/tsconfig\.json$/, "")))
    .filter((dir) => existsSync(join(dir, "tsconfig.json")));
  return expanded.length > 0 ? expanded : [projectPath];
}

/**
 * type-coverage does not fail when dependencies are missing — it
 * succeeds with a plausible wrong number, because every identifier
 * reached through an unresolvable import degrades to `any`. One repo
 * read 86.8% typed without `node_modules` and 99.98% with it, and the
 * difference manufactured 15 "corroborated" offenders out of nothing
 * (#383). A number we cannot trust is worse than no number.
 */
export function dependenciesInstalled(projectPath: string): boolean {
  let manifest: { dependencies?: object; devDependencies?: object };
  try {
    manifest = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf-8"));
  } catch {
    // No manifest here (a referenced sub-project): nothing to verify.
    return true;
  }
  const declared =
    Object.keys(manifest.dependencies ?? {}).length +
    Object.keys(manifest.devDependencies ?? {}).length;
  if (declared === 0) return true;
  // Hoisted installs live at an ancestor; walk up to the filesystem root.
  let dir = projectPath;
  for (;;) {
    if (existsSync(join(dir, "node_modules"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function runTypeCoverage(
  rootPath: string,
  roots: string[] = ["."],
): TypeCoverageResult {
  const bin = typeCoverageBin();
  if (!bin) {
    return { available: false, anyCounts: new Map(), percent: null };
  }
  const anyCounts = new Map<string, number>();
  let covered = 0;
  let total = 0;
  let anyAvailable = false;

  const disclosures: string[] = [];
  const projects: { root: string; projectPath: string }[] = [];
  for (const root of roots) {
    const base = root === "." ? rootPath : join(rootPath, root);
    if (!existsSync(join(base, "tsconfig.json"))) continue;
    for (const projectPath of expandSolutionTsconfig(base)) {
      projects.push({ root, projectPath });
    }
  }

  for (const { root, projectPath } of projects) {
    if (!dependenciesInstalled(projectPath)) {
      const note =
        `dependencies are not installed at ${projectPath.replace(rootPath, ".")} — ` +
        "type-coverage would report a plausible wrong percentage (every " +
        "unresolvable import degrades to `any`), so this project is skipped";
      console.warn(`type-coverage skipped: ${note}`);
      disclosures.push(note);
      continue;
    }

    const run = spawnSync(
      "node",
      [bin, "-p", projectPath, "--detail"],
      {
        // type-coverage matches files relative to the cwd; anywhere else
        // (e.g. the action checkout in CI) it silently scans 0 files.
        cwd: projectPath,
        encoding: "utf-8",
        maxBuffer: 256 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      },
    );
    const stdout = run.stdout ?? "";
    const summary = stdout.match(/\((\d+) \/ (\d+)\) [\d.]+%/);
    // "0 / 0" (no percent printed) means the project matched no files —
    // a misconfiguration, never a 100%-typed success.
    if (run.error || !summary) {
      // Never fail silently — the disclosure says "unavailable" and the
      // log must say why (round-8: CI degradation was undiagnosable).
      console.warn(`type-coverage failed at ${root}: ${describeRunFailure(run)}`);
      continue;
    }
    anyAvailable = true;
    covered += Number(summary[1]);
    total += Number(summary[2]);

    const posixProject = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
    for (const line of stdout.split("\n")) {
      const match = line.match(/^(.+?):\d+:\d+: /);
      if (!match) continue;
      let path = match[1].replace(/\\/g, "/");
      if (path.startsWith(posixProject + "/")) {
        path = path.slice(posixProject.length + 1);
      }
      // Repo-relative, whatever cwd type-coverage printed from.
      if (root !== "." && !path.startsWith(root + "/")) path = `${root}/${path}`;
      anyCounts.set(path, (anyCounts.get(path) ?? 0) + 1);
    }
  }

  if (!anyAvailable) {
    return { available: false, anyCounts: new Map(), percent: null, disclosures };
  }
  return {
    available: true,
    anyCounts,
    percent: total > 0 ? Math.round((covered / total) * 10000) / 100 : null,
    disclosures,
  };
}
