/**
 * Lightweight TS/JS import graph for the arrival lane's graph join (L3)
 *
 * Regex import extraction + relative-specifier resolution over the tracked
 * candidate set — no module-resolution config, no aliases (disclosed
 * approximation; the full multi-language graph is an M3 item). The current
 * graph approximates history: near-exact on young repos, anachronistic in
 * both directions on old ones (design §3.1-L3 bias note).
 */

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

const TSJS_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

export function isTsJsFile(path: string): boolean {
  return TSJS_EXTENSIONS.some((ext) => path.endsWith(ext));
}

const IMPORT_PATTERNS: RegExp[] = [
  /(?:import|export)\s[^'"()]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function extractImportSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      specs.add(match[1]);
    }
  }
  return [...specs];
}

/**
 * Resolve a relative specifier against the importing file. Only paths
 * inside the candidate set resolve; package imports return null.
 */
export function resolveSpecifier(
  importer: string,
  spec: string,
  candidates: Set<string>,
): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const base = posix.normalize(posix.join(posix.dirname(importer), spec));

  const tries: string[] = [base];
  // ESM-style ".js" specifiers usually point at ".ts" sources.
  const jsToTs = base.replace(/\.(js|jsx|mjs|cjs)$/, (m) =>
    m === ".jsx" ? ".tsx" : m === ".mjs" ? ".mts" : m === ".cjs" ? ".cts" : ".ts",
  );
  if (jsToTs !== base) tries.push(jsToTs);
  for (const ext of TSJS_EXTENSIONS) tries.push(base + ext);
  for (const ext of TSJS_EXTENSIONS) tries.push(posix.join(base, `index${ext}`));

  for (const candidate of tries) {
    if (candidates.has(candidate)) return candidate;
  }
  return null;
}

export interface ImportData {
  /** Forward graph over resolved relative imports (TS/JS candidates). */
  graph: Map<string, string[]>;
  /** Raw package specifiers per file (non-relative, unresolved). */
  packageImports: Map<string, string[]>;
}

/** One pass over the TS/JS subset: graph + package import sites. */
export function buildImportData(
  rootPath: string,
  candidateFiles: string[],
): ImportData {
  const tsjs = candidateFiles.filter(isTsJsFile);
  const candidates = new Set(tsjs);
  const graph = new Map<string, string[]>();
  const packageImports = new Map<string, string[]>();
  for (const file of tsjs) {
    let source: string;
    try {
      source = readFileSync(join(rootPath, file), "utf-8");
    } catch {
      graph.set(file, []);
      continue;
    }
    const targets = new Set<string>();
    const packages = new Set<string>();
    for (const spec of extractImportSpecifiers(source)) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const resolved = resolveSpecifier(file, spec, candidates);
        if (resolved && resolved !== file) targets.add(resolved);
      } else if (!spec.startsWith("node:")) {
        const segments = spec.split("/");
        packages.add(
          spec.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0],
        );
      }
    }
    graph.set(file, [...targets].sort());
    if (packages.size > 0) packageImports.set(file, [...packages].sort());
  }
  return { graph, packageImports };
}

/** Forward import graph over the TS/JS subset of candidate files. */
export function buildImportGraph(
  rootPath: string,
  candidateFiles: string[],
): Map<string, string[]> {
  return buildImportData(rootPath, candidateFiles).graph;
}

/** Files transitively imported from `start` (excluding `start` itself). */
export function reachableFrom(
  graph: Map<string, string[]>,
  start: string,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...(graph.get(start) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const target of graph.get(next) ?? []) {
      if (!seen.has(target)) queue.push(target);
    }
  }
  return seen;
}
