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
 *  - CI/service execution (round-7): GitHub workflow YAML, systemd
 *    units, Procfile, Dockerfile — script-path tokens are invocations.
 *  - Documented run commands in markdown (`node scripts/x.mjs`) — a
 *    README-documented workflow is a consumer.
 *  - Script paths passed to calls inside code files (`read('editor.js')`,
 *    `spawn("python3", ["tools/gen.py"])`) — hand-rolled bundlers and
 *    process spawns load files no import graph sees.
 *  - Re-exports from entry files, transitively: a published barrel's
 *    `export { x } from "./impl"` makes impl.ts published surface too.
 *  - Generated-artifact producers: when a script tag or config main
 *    references a file that is NOT tracked (a build product), the
 *    tracked code file that names that artifact is its producer and is
 *    reachable through it (round-7: build.js → editor.bundle.js →
 *    editor.html).
 */

import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";


/** Candidate-set lookup with extension fallbacks for TS sources. */
function resolveToCandidate(
  path: string,
  candidates: Set<string>,
): string | null {
  // Bundler query/hash suffixes (?raw, ?url) are load semantics, not path.
  const clean = posix
    .normalize(path.replace(/^\.\//, ""))
    .replace(/[?#].*$/, "");
  if (candidates.has(clean)) return clean;
  const tries: string[] = [];
  // dist/x.js → src/x.ts (published-surface back-mapping), at any depth:
  // a nested package's "./dist/worker.js" arrives here as
  // "packages/logger/dist/worker.js".
  const buildDirAt = clean.match(
    /(^|\/)(dist|build|lib|out|es|esm|cjs)\//,
  );
  if (buildDirAt) {
    const prefix = clean.slice(0, (buildDirAt.index ?? 0)) + (buildDirAt[1] || "");
    const stripped = clean.slice(
      (buildDirAt.index ?? 0) + buildDirAt[0].length,
    );
    for (const mid of ["src/", "", "lib/"]) {
      tries.push(prefix + mid + stripped);
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
  // Basename → consumer, for trusted consumption points that reference
  // an untracked (generated) file; resolved to producers at the end.
  const unresolvedArtifacts = new Map<string, string>();
  const mark = (
    raw: string,
    baseDir: string,
    source: string,
    trackArtifact = false,
  ): void => {
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
    if (trackArtifact && /\.[cm]?jsx?$/.test(raw)) {
      const base = raw.slice(raw.lastIndexOf("/") + 1);
      if (!unresolvedArtifacts.has(base)) unresolvedArtifacts.set(base, source);
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

  // --- framework templates (.astro/.vue/.svelte) --------------------------
  // Template files sit outside the TS/JS import graph, so scripts they
  // pull in (frontmatter imports, ?raw loaders, src attributes) look
  // orphaned without this pass.
  for (const templatePath of candidateFiles.filter((f) =>
    /\.(astro|vue|svelte)$/.test(f),
  )) {
    const raw = read(templatePath);
    if (!raw) continue;
    const dir = dirname(templatePath) === "." ? "" : dirname(templatePath);
    for (const match of raw.matchAll(
      /(?:import\s[^'"]*?from\s*|import\s*\(\s*|src=)["']([^"']+)["']/g,
    )) {
      if (match[1].startsWith(".") || match[1].startsWith("/")) {
        mark(match[1], dir, templatePath);
      }
    }
  }

  // --- HTML script tags ---------------------------------------------------
  for (const htmlPath of candidateFiles.filter((f) => /\.html?$/.test(f))) {
    const raw = read(htmlPath);
    if (!raw) continue;
    const dir = dirname(htmlPath) === "." ? "" : dirname(htmlPath);
    for (const match of raw.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
      mark(match[1], dir, htmlPath, true);
      // Vite-style roots often serve from public/ or src/ siblings.
      mark(match[1].replace(/^\//, ""), "", htmlPath, true);
    }
  }

  // --- CI / service execution surfaces ------------------------------------
  // Workflow YAML, systemd units, Procfile, Dockerfile: a script-path
  // token in any of these is an invocation. Tokens are matched bare
  // (workflow `run: node scripts/x.mjs` quotes nothing).
  const SCRIPT_TOKEN = /(?:^|[\s='"("`])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)+\.(?:[cm]?[jt]sx?|py|sh))(?=$|[\s'")`;])/gm;
  for (const execPath of candidateFiles.filter((f) =>
    /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|\.(service|timer)$|(^|\/)(Procfile|Dockerfile[^/]*)$/.test(
      f,
    ),
  )) {
    const raw = read(execPath);
    if (!raw) continue;
    const dir = dirname(execPath) === "." ? "" : dirname(execPath);
    for (const match of raw.matchAll(SCRIPT_TOKEN)) {
      mark(match[1], "", execPath);
      mark(match[1], dir, execPath);
    }
  }

  // --- documented run commands in markdown --------------------------------
  // Only command-shaped lines count — marking every path a doc mentions
  // would exempt half the repo.
  for (const mdPath of candidateFiles.filter((f) => /\.(md|mdx)$/i.test(f))) {
    const raw = read(mdPath);
    if (!raw) continue;
    for (const match of raw.matchAll(
      /(?:^|[\s`$])(?:node|python3?|npx|pnpm|yarn|bun|deno|bash|sh|tsx)\s+(?:[-\w]+\s+)*((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:[cm]?[jt]sx?|py|sh))/gm,
    )) {
      mark(match[1], "", mdPath);
      mark(match[1], dirname(mdPath) === "." ? "" : dirname(mdPath), mdPath);
    }
  }

  // --- script paths passed to calls in code files -------------------------
  // `read('editor.js')`, `spawnSync("python3", ["tools/gen.py"])`,
  // `new Worker("./worker.js")`: runtime loading the import graph cannot
  // see. Restricted to quoted script paths inside a call's argument list
  // so prose and dead strings don't become roots.
  const CALLED_PATH = /[\w$.]+\s*\([^()]*?["'`]((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:[cm]?[jt]sx?|py|sh))["'`]/g;
  for (const codePath of candidateFiles.filter((f) =>
    /\.([cm]?[jt]sx?|py)$/.test(f),
  )) {
    const raw = read(codePath);
    if (!raw) continue;
    const dir = dirname(codePath) === "." ? "" : dirname(codePath);
    for (const match of raw.matchAll(CALLED_PATH)) {
      // Own-name mentions aren't consumption.
      if (match[1].endsWith(codePath.slice(codePath.lastIndexOf("/") + 1)) &&
          resolveToCandidate(match[1], new Set([codePath])) === codePath) {
        continue;
      }
      mark(match[1], dir, codePath);
    }
  }

  // --- re-export propagation from entry files -----------------------------
  // A published barrel's `export ... from "./impl"` makes impl part of
  // the published surface: dead-surface claims one hop deeper are the
  // same FP class the entry exemption exists for. Fixpoint with a hop
  // cap; entry files whose re-export targets are already entries stop
  // the walk.
  const RE_EXPORT = /export\s+(?:\*(?:\s+as\s+[\w$]+)?|type\s*\{[^}]*\}|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
  for (let hop = 0; hop < 4; hop++) {
    const added: string[] = [];
    for (const entry of [...entries]) {
      if (!/\.[cm]?[jt]sx?$/.test(entry)) continue;
      const raw = read(entry);
      if (!raw) continue;
      const dir = dirname(entry) === "." ? "" : dirname(entry);
      for (const match of raw.matchAll(RE_EXPORT)) {
        const spec = match[1];
        if (!spec.startsWith(".")) continue;
        const base = posix.normalize(posix.join(dir, spec));
        for (const attempt of /\.[\w]+$/.test(base)
          ? [base]
          : [
              `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`,
              `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.jsx`,
              `${base}/index.ts`, `${base}/index.js`,
            ]) {
          const hit = resolveToCandidate(attempt, candidates);
          if (hit && !entries.has(hit)) {
            added.push(hit);
            if (!sources.has(hit)) sources.set(hit, `re-export of ${entry}`);
          }
          if (hit) break;
        }
      }
    }
    if (added.length === 0) break;
    for (const path of added) entries.add(path);
  }

  // --- generated-artifact producers ---------------------------------------
  // A consumed-but-untracked script is a build product; the tracked code
  // file that names it (quoted) is its producer, reachable through the
  // consumer. Quoted-name precision keeps prose mentions out.
  if (unresolvedArtifacts.size > 0) {
    for (const codePath of candidateFiles.filter((f) =>
      /\.([cm]?[jt]sx?|py)$/.test(f),
    )) {
      if (entries.has(codePath)) continue;
      const raw = read(codePath);
      if (!raw) continue;
      for (const [base, consumer] of unresolvedArtifacts) {
        if (raw.includes(`'${base}'`) || raw.includes(`"${base}"`) || raw.includes(`\`${base}\``)) {
          entries.add(codePath);
          if (!sources.has(codePath)) {
            sources.set(codePath, `producer of ${base} (consumed by ${consumer})`);
          }
          break;
        }
      }
    }
  }

  return { entries, sources };
}
