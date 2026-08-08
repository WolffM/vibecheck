/**
 * Exclusion pre-pass (design §3)
 *
 * Removes generated/vendored files before any lane sees them:
 *   1. path conventions (vendor dirs, lockfiles, generated-file suffixes)
 *   2. .gitattributes `linguist-generated` / `linguist-vendored` (exact git
 *      semantics via `git check-attr`)
 *   3. `@generated` / `DO NOT EDIT` markers in the first 5 lines
 *
 * First matching rule wins; the excluded set is reported once as an
 * appendix count, never itemized in the report body.
 */

import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export type ExclusionReason =
  | "path-convention"
  | "gitattributes"
  | "generated-header"
  | "config";

export interface Exclusion {
  path: string;
  reason: ExclusionReason;
}

export interface ExclusionResult {
  kept: string[];
  excluded: Exclusion[];
}

const EXCLUDED_DIRS = new Set([
  "vendor",
  "third_party",
  "dist",
  "build",
  "node_modules",
  "__snapshots__",
  "migrations",
  ".vibecheck",
  ".vibecompact",
  // Fixture dirs are test assets — often deliberately-bad code — and
  // belong with snapshot dirs, not in any lane.
  "fixtures",
  "test-fixtures",
  "__fixtures__",
  "testdata",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "gradle.lockfile",
]);

const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  /_pb2(_grpc)?\.pyi?$/,
  /\.pb\.go$/,
  /\.gen\.[^./]+$/,
  /\.min\.(js|css|mjs|cjs)$/,
  /\.(snap|snap\.\w+)$/,
];

function matchesPathConvention(relPath: string): boolean {
  const posix = relPath.replace(/\\/g, "/");
  const segments = posix.split("/");
  const base = segments[segments.length - 1];
  if (segments.slice(0, -1).some((dir) => EXCLUDED_DIRS.has(dir))) return true;
  if (LOCKFILES.has(base)) return true;
  return EXCLUDED_FILE_PATTERNS.some((re) => re.test(base));
}

/**
 * Fast path-only exclusion check (no git attrs, no header sniffing) —
 * the activity gate's subset: it must run in milliseconds and only needs
 * to keep vendored/generated churn out of the volume count.
 */
export function isPathExcludedFast(
  relPath: string,
  configExcludes: string[] = [],
): boolean {
  if (
    configExcludes.some(
      (prefix) => relPath === prefix || relPath.startsWith(prefix + "/"),
    )
  ) {
    return true;
  }
  return matchesPathConvention(relPath);
}

/**
 * Batch-query linguist-generated/linguist-vendored via git. Returns the
 * subset of `files` excluded by attributes; empty outside a git repo.
 */
function gitAttrExcluded(rootPath: string, files: string[]): Set<string> {
  const excluded = new Set<string>();
  if (files.length === 0) return excluded;
  let output: string;
  try {
    output = execFileSync(
      "git",
      ["check-attr", "--stdin", "-z", "linguist-generated", "linguist-vendored"],
      {
        cwd: rootPath,
        encoding: "utf-8",
        input: files.join("\0"),
        stdio: ["pipe", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch {
    return excluded;
  }
  // -z output is a flat NUL-separated stream: path, attr, value, repeated.
  const parts = output.split("\0");
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const value = parts[i + 2];
    if (value === "set" || value === "true") excluded.add(parts[i]);
  }
  return excluded;
}

const HEADER_MARKERS = [/@generated/i, /do not edit/i];
const HEADER_SNIFF_BYTES = 2048;

/** True when one of the first 5 lines carries a generated-code marker. */
function hasGeneratedHeader(absPath: string): boolean {
  let fd: number;
  try {
    fd = openSync(absPath, "r");
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.alloc(HEADER_SNIFF_BYTES);
    const bytesRead = readSync(fd, buffer, 0, HEADER_SNIFF_BYTES, 0);
    const head = buffer
      .toString("utf-8", 0, bytesRead)
      .split(/\r?\n/, 5)
      .join("\n");
    return HEADER_MARKERS.some((re) => re.test(head));
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/**
 * Partition repo-relative paths into kept and excluded. Output order is
 * sorted for determinism regardless of input order. `configExcludes` are
 * user-attested path prefixes from `audit.exclude`.
 */
export function applyExclusions(
  rootPath: string,
  files: string[],
  configExcludes: string[] = [],
): ExclusionResult {
  const sorted = [...files].sort();
  const kept: string[] = [];
  const excluded: Exclusion[] = [];

  const matchesConfig = (file: string): boolean =>
    configExcludes.some(
      (prefix) => file === prefix || file.startsWith(prefix + "/"),
    );

  const afterConvention: string[] = [];
  for (const file of sorted) {
    if (matchesConfig(file)) {
      excluded.push({ path: file, reason: "config" });
    } else if (matchesPathConvention(file)) {
      excluded.push({ path: file, reason: "path-convention" });
    } else {
      afterConvention.push(file);
    }
  }

  const byAttr = gitAttrExcluded(rootPath, afterConvention);
  for (const file of afterConvention) {
    if (byAttr.has(file)) {
      excluded.push({ path: file, reason: "gitattributes" });
    } else if (hasGeneratedHeader(join(rootPath, file))) {
      excluded.push({ path: file, reason: "generated-header" });
    } else {
      kept.push(file);
    }
  }

  excluded.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { kept, excluded };
}
