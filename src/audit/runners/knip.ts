/**
 * knip runner (dead-code lane substrate, TS/JS)
 *
 * JSON reporter over the target repo. knip respects the repo's own
 * knip.json when present; without one its entry auto-detection can be
 * wrong in a characteristic way (spawned-not-imported entries), which the
 * lane guards with the implausible-share mute.
 */

import { spawnSync } from "node:child_process";

export interface KnipResult {
  available: boolean;
  /** Files knip believes are entirely unused. */
  unusedFiles: string[];
  /** Unused export/type count per file. */
  unusedExports: Map<string, number>;
}

interface KnipJsonIssue {
  file: string;
  exports?: { name: string }[];
  types?: { name: string }[];
}

interface KnipJson {
  files?: string[];
  issues?: KnipJsonIssue[];
}

export function runKnip(rootPath: string): KnipResult {
  const run = spawnSync("npx", ["knip", "--reporter", "json", "--no-progress"], {
    cwd: rootPath,
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
    if (run.stderr) console.warn(`knip failed: ${run.stderr.slice(0, 200)}`);
    return { available: false, unusedFiles: [], unusedExports: new Map() };
  }

  let parsed: KnipJson;
  try {
    parsed = JSON.parse(stdout.slice(jsonStart)) as KnipJson;
  } catch (error) {
    console.warn(`knip produced unparseable JSON: ${error}`);
    return { available: false, unusedFiles: [], unusedExports: new Map() };
  }

  const unusedExports = new Map<string, number>();
  for (const issue of parsed.issues ?? []) {
    const count = (issue.exports?.length ?? 0) + (issue.types?.length ?? 0);
    if (count > 0) {
      const path = issue.file.replace(/\\/g, "/");
      unusedExports.set(path, (unusedExports.get(path) ?? 0) + count);
    }
  }
  return {
    available: true,
    unusedFiles: (parsed.files ?? []).map((f) => f.replace(/\\/g, "/")),
    unusedExports,
  };
}
