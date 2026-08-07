/**
 * Entry-point detection (round-1 FP kill)
 *
 * Round 1's two systematic false-positive classes were both "the tool
 * cannot see how this file is reached": published package entries mapped
 * through dist/, and executed-not-imported scripts (pm2, cron, worker
 * configs, browser script tags). This pass parses the places entry
 * points are actually declared and feeds the roots to the orphan and
 * dead-code detectors — fixing the class once, centrally, instead of
 * taxing every repo three noise verdicts per lane to rediscover it.
 *
 * Sources scanned (all soft — unreadable files are skipped):
 *  - package.json (all of them): main / module / browser / types / bin /
 *    exports (recursed) / scripts, with dist→src back-mapping so a
 *    published `dist/server/index.js` marks `src/server/index.ts`.
 *  - wrangler.toml / wrangler.json / wrangler.jsonc: `main`.
 *  - pm2 ecosystem files (ecosystem*.{js,cjs,json}) and any
 *    *.config.{js,cjs,mjs}: path-like script references.
 *  - HTML files: <script src>, resolved relative to the HTML file and
 *    against the repo root.
 */

import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

const BUILD_DIR_PATTERN = /^(?:\.\/)?(dist|build|lib|out|es|esm|cjs)\//;

/** Candidate-set lookup with extension fallbacks for TS sources. */
function resolveToCandidate(
  path: string,
  candidates: Set<string>,
): string | null {
  const clean = posix.normalize(path.replace(/^\.\//, ""));
  if (candidates.has(clean)) return clean;
  const tries: string[] = [];
  // dist/x.js → src/x.ts (published-surface back-mapping).
  if (BUILD_DIR_PATTERN.test(clean)) {
    const stripped = clean.replace(BUILD_DIR_PATTERN, "");
    for (const prefix of ["src/", "", "lib/"]) {
      tries.push(prefix + stripped);
    }
  }
  tries.push(clean);
  const expanded: string[] = [];
  for (const t of tries) {
    expanded.push(t);
    const swapped = t
      .replace(/\.d\.ts$/, ".ts")
      .replace(/\.(js|mjs|cjs|jsx)$/, (m) =>
        m === ".jsx" ? ".tsx" : m === ".mjs" ? ".mts" : m === ".cjs" ? ".cts" : ".ts",
      );
    if (swapped !== t) expanded.push(swapped);
  }
  for (const t of expanded) {
    if (candidates.has(t)) return t;
  }
  return null;
}

const PATHISH = /["'`]([\w@./-]+\.(?:[cm]?[jt]sx?|py))["'`]/g;

function collectPathish(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(PATHISH)) out.push(match[1]);
  return out;
}

function walkJsonStrings(value: unknown, sink: string[]): void {
  if (typeof value === "string") sink.push(value);
  else if (Array.isArray(value)) for (const v of value) walkJsonStrings(v, sink);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) walkJsonStrings(v, sink);
  }
}

export interface EntryPointResult {
  /** Repo-relative candidate files that are reachable entry points. */
  entries: Set<string>;
  /** entry → the declaration that made it one (first source wins). */
  sources: Map<string, string>;
}

export function detectEntryPoints(
  rootPath: string,
  candidateFiles: string[],
): EntryPointResult {
  const candidates = new Set(candidateFiles);
  const entries = new Set<string>();
  const sources = new Map<string, string>();
  const read = (rel: string): string | null => {
    try {
      return readFileSync(join(rootPath, rel), "utf-8");
    } catch {
      return null;
    }
  };
  const mark = (raw: string, baseDir: string, source: string): void => {
    if (/^(https?:)?\/\//.test(raw)) return;
    const relToBase =
      baseDir && !raw.startsWith("/")
        ? posix.normalize(posix.join(baseDir, raw))
        : raw.replace(/^\//, "");
    for (const attempt of [relToBase, raw.replace(/^\//, "")]) {
      const hit = resolveToCandidate(attempt, candidates);
      if (hit) {
        entries.add(hit);
        if (!sources.has(hit)) sources.set(hit, source);
        return;
      }
    }
  };

  // --- package.json (every one in the repo) -------------------------------
  for (const pkgPath of candidateFiles.filter(
    (f) => f === "package.json" || f.endsWith("/package.json"),
  )) {
    const raw = read(pkgPath);
    if (!raw) continue;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const pkgDir = dirname(pkgPath) === "." ? "" : dirname(pkgPath);
    const refs: string[] = [];
    for (const field of ["main", "module", "browser", "types"]) {
      if (typeof pkg[field] === "string") refs.push(pkg[field] as string);
    }
    walkJsonStrings(pkg.bin, refs);
    walkJsonStrings(pkg.exports, refs);
    if (pkg.scripts && typeof pkg.scripts === "object") {
      for (const script of Object.values(pkg.scripts as Record<string, string>)) {
        if (typeof script !== "string") continue;
        for (const token of script.split(/\s+/)) {
          if (/\.([cm]?[jt]sx?|py)$/.test(token)) refs.push(token);
        }
      }
    }
    for (const ref of refs) {
      if (/\.[\w]+$/.test(ref)) mark(ref, pkgDir, `${pkgPath}`);
    }
  }

  // --- wrangler configs ---------------------------------------------------
  for (const wranglerPath of candidateFiles.filter((f) =>
    /(^|\/)wrangler\.(toml|jsonc?)$/.test(f),
  )) {
    const raw = read(wranglerPath);
    if (!raw) continue;
    const dir = dirname(wranglerPath) === "." ? "" : dirname(wranglerPath);
    for (const match of raw.matchAll(
      /["']?main["']?\s*[:=]\s*["']([^"']+)["']/g,
    )) {
      mark(match[1], dir, wranglerPath);
    }
  }

  // --- pm2 ecosystem + generic config files ------------------------------
  for (const configPath of candidateFiles.filter((f) =>
    /(^|\/)(ecosystem[^/]*\.(js|cjs|json)|[^/]+\.config\.(js|cjs|mjs))$/.test(f),
  )) {
    const raw = read(configPath);
    if (!raw) continue;
    const dir = dirname(configPath) === "." ? "" : dirname(configPath);
    for (const ref of collectPathish(raw)) {
      mark(ref, dir, configPath);
    }
  }

  // --- HTML script tags ---------------------------------------------------
  for (const htmlPath of candidateFiles.filter((f) => /\.html?$/.test(f))) {
    const raw = read(htmlPath);
    if (!raw) continue;
    const dir = dirname(htmlPath) === "." ? "" : dirname(htmlPath);
    for (const match of raw.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
      mark(match[1], dir, htmlPath);
      // Vite-style roots often serve from public/ or src/ siblings.
      mark(match[1].replace(/^\//, ""), "", htmlPath);
    }
  }

  return { entries, sources };
}
