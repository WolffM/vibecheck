/**
 * JS/TS subproject root discovery (pygmalion beta finding 2)
 *
 * knip and type-coverage are per-project tools: they must run from the
 * directory holding package.json / tsconfig.json. Polyglot repos
 * routinely keep the web app in a subdirectory (Python root with a
 * `frontend/` Vite app), where a root-only probe reports the whole JS
 * side as unassessable. Roots come from `audit.js_roots` when
 * configured; otherwise they are discovered from tracked package.json
 * files, pruned to the top-level-most so workspace roots subsume their
 * member packages.
 */

/**
 * Repo-relative project roots ("." for the repo root). Configured roots
 * win verbatim; discovery prunes nested package.json dirs, so a repo
 * with a root manifest keeps today's single-root behavior.
 */
export function discoverJsRoots(
  candidateFiles: string[],
  configured: string[] = [],
): string[] {
  if (configured.length > 0) return [...new Set(configured)];

  const dirs = candidateFiles
    .filter((f) => f === "package.json" || f.endsWith("/package.json"))
    .map((f) => (f === "package.json" ? "." : f.slice(0, -"/package.json".length)))
    .sort((a, b) => a.length - b.length);

  const roots: string[] = [];
  for (const dir of dirs) {
    const nested = roots.some(
      (r) => r === "." || dir === r || dir.startsWith(r + "/"),
    );
    if (!nested) roots.push(dir);
  }
  return roots;
}
