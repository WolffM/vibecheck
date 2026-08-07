/**
 * knip runner (dead-code lane substrate, TS/JS)
 *
 * JSON reporter over the target repo. knip respects the repo's own
 * knip.json when present; without one its entry auto-detection can be
 * wrong in a characteristic way (spawned-not-imported entries), which the
 * lane guards with the implausible-share mute.
 */

import { spawnSync } from "node:child_process";

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

  const unusedExports = new Map<string, DeadExport[]>();
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
      const path = issue.file.replace(/\\/g, "/");
      unusedExports.set(path, [
        ...(unusedExports.get(path) ?? []),
        ...items,
      ]);
    }
  }
  return {
    available: true,
    unusedFiles: (parsed.files ?? []).map((f) => f.replace(/\\/g, "/")),
    unusedExports,
  };
}
