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
import { createRequire } from "node:module";
import { join } from "node:path";

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
}

/**
 * Runs once per JS project root that carries a tsconfig.json (see
 * roots.ts) — a repo whose TS app lives in a subdirectory has no root
 * tsconfig to probe. Paths in the result are always repo-relative; the
 * percent is aggregated over all roots from the covered/total counts.
 */
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

  for (const root of roots) {
    const projectPath = root === "." ? rootPath : join(rootPath, root);
    if (!existsSync(join(projectPath, "tsconfig.json"))) continue;

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
      const tail = (text: string | null | undefined) =>
        (text ?? "").trim().split("\n").slice(-2).join(" | ");
      console.warn(
        `type-coverage failed at ${root}: ` +
          [
            run.error?.message,
            `status ${run.status}`,
            tail(run.stderr) && `stderr: ${tail(run.stderr)}`,
            tail(stdout) && `stdout: ${tail(stdout)}`,
          ]
            .filter(Boolean)
            .join(" · "),
      );
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
    return { available: false, anyCounts: new Map(), percent: null };
  }
  return {
    available: true,
    anyCounts,
    percent: total > 0 ? Math.round((covered / total) * 10000) / 100 : null,
  };
}
