/**
 * knip runner (dead-code lane substrate, TS/JS)
 *
 * JSON reporter over the target repo. knip respects the repo's own
 * knip.json when present; without one its entry auto-detection can be
 * wrong in a characteristic way (spawned-not-imported entries), which the
 * lane guards with the implausible-share mute.
 *
 * Runs once per JS project root (see roots.ts) — knip needs a
 * package.json at its cwd, which polyglot repos keep in a subdirectory.
 * Paths in the result are always repo-relative.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export interface DeadExport {
  name: string;
  line: number;
  kind: "export" | "type";
}

export interface KnipResult {
  available: boolean;
  /** Files knip believes are entirely unused. */
  unusedFiles: string[];
  /** Unused exports/types per file, with names and lines. */
  unusedExports: Map<string, DeadExport[]>;
}

interface KnipJsonIssue {
  file: string;
  exports?: { name: string; line?: number }[];
  types?: { name: string; line?: number }[];
}

interface KnipJson {
  files?: string[];
  issues?: KnipJsonIssue[];
}

function runKnipAt(rootPath: string, root: string): KnipJson | null {
  const run = spawnSync("npx", ["knip", "--reporter", "json", "--no-progress"], {
    cwd: root === "." ? rootPath : join(rootPath, root),
    encoding: "utf-8",
    shell: process.platform === "win32",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  // knip exits non-zero when it finds anything; only a missing/failed
  // binary leaves stdout without JSON.
  const stdout = run.stdout ?? "";
  const jsonStart = stdout.indexOf("{");
  if (run.error || jsonStart === -1) {
    if (run.stderr) console.warn(`knip failed at ${root}: ${run.stderr.slice(0, 200)}`);
    return null;
  }
  try {
    return JSON.parse(stdout.slice(jsonStart)) as KnipJson;
  } catch (error) {
    console.warn(`knip produced unparseable JSON at ${root}: ${error}`);
    return null;
  }
}

export function runKnip(rootPath: string, roots: string[] = ["."]): KnipResult {
  const unusedFiles: string[] = [];
  const unusedExports = new Map<string, DeadExport[]>();
  let anyAvailable = false;

  for (const root of roots) {
    const parsed = runKnipAt(rootPath, root);
    if (!parsed) continue;
    anyAvailable = true;
    // knip reports paths relative to its cwd — rebase onto the repo.
    const rebase = (p: string) => {
      const posix = p.replace(/\\/g, "/");
      return root === "." ? posix : `${root}/${posix}`;
    };

    unusedFiles.push(...(parsed.files ?? []).map(rebase));
    for (const issue of parsed.issues ?? []) {
      const items: DeadExport[] = [
        ...(issue.exports ?? []).map((e) => ({
          name: e.name,
          line: e.line ?? 0,
          kind: "export" as const,
        })),
        ...(issue.types ?? []).map((e) => ({
          name: e.name,
          line: e.line ?? 0,
          kind: "type" as const,
        })),
      ];
      if (items.length > 0) {
        const path = rebase(issue.file);
        unusedExports.set(path, [...(unusedExports.get(path) ?? []), ...items]);
      }
    }
  }
  return { available: anyAvailable, unusedFiles, unusedExports };
}
