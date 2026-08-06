/**
 * scc runner (size lane substrate)
 *
 * All audit line counting uses scc **code lines** (design §3) — never raw
 * line counts. Soft-skips when the binary is missing; the lane discloses
 * the gap instead of guessing.
 */

import { spawnSync } from "node:child_process";

/** Version the action installs; local runs accept any scc >= 3. */
export const SCC_PINNED_VERSION = "3.7.0";

export interface SccFileMetrics {
  path: string;
  language: string;
  codeLines: number;
  complexity: number;
}

export interface SccResult {
  available: boolean;
  version: string | null;
  files: SccFileMetrics[];
}

interface SccByFileEntry {
  Language: string;
  Location: string;
  Code: number;
  Complexity: number;
}

interface SccLanguageSummary {
  Name: string;
  Files: SccByFileEntry[];
}

function normalizePath(location: string): string {
  return location.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function runScc(rootPath: string): SccResult {
  const probe = spawnSync("scc", ["--version"], {
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (probe.error || probe.status !== 0) {
    return { available: false, version: null, files: [] };
  }
  const version = probe.stdout.trim().match(/\d+\.\d+\.\d+/)?.[0] ?? null;

  const run = spawnSync(
    "scc",
    ["--by-file", "--format", "json", "--no-cocomo", "."],
    {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (run.error || run.status !== 0 || !run.stdout) {
    console.warn(`scc run failed: ${run.stderr?.trim() || run.error?.message}`);
    return { available: false, version, files: [] };
  }

  let summaries: SccLanguageSummary[];
  try {
    summaries = JSON.parse(run.stdout) as SccLanguageSummary[];
  } catch (error) {
    console.warn(`scc produced unparseable JSON: ${error}`);
    return { available: false, version, files: [] };
  }

  const files: SccFileMetrics[] = [];
  for (const summary of summaries) {
    for (const file of summary.Files ?? []) {
      files.push({
        path: normalizePath(file.Location),
        language: file.Language ?? summary.Name,
        codeLines: file.Code,
        complexity: file.Complexity,
      });
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { available: true, version, files };
}
