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
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface TypeCoverageResult {
  available: boolean;
  /** any-typed identifier count per repo-relative file. */
  anyCounts: Map<string, number>;
  /** Overall covered/total from the summary line, when present. */
  percent: number | null;
}

export function runTypeCoverage(rootPath: string): TypeCoverageResult {
  if (!existsSync(join(rootPath, "tsconfig.json"))) {
    return { available: false, anyCounts: new Map(), percent: null };
  }

  const run = spawnSync(
    "npx",
    ["type-coverage", "-p", rootPath, "--detail"],
    {
      encoding: "utf-8",
      shell: process.platform === "win32",
      maxBuffer: 256 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    },
  );
  const stdout = run.stdout ?? "";
  const summary = stdout.match(/\(\d+ \/ \d+\) ([\d.]+)%/);
  if (run.error || !summary) {
    return { available: false, anyCounts: new Map(), percent: null };
  }

  const posixRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const anyCounts = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(.+?):\d+:\d+: /);
    if (!match) continue;
    let path = match[1].replace(/\\/g, "/");
    if (path.startsWith(posixRoot + "/")) path = path.slice(posixRoot.length + 1);
    anyCounts.set(path, (anyCounts.get(path) ?? 0) + 1);
  }
  return { available: true, anyCounts, percent: Number(summary[1]) };
}
