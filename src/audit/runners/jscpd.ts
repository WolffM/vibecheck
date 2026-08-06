/**
 * jscpd runner (duplication lane substrate)
 *
 * Runs jscpd over the repo with the configured minimum block size and
 * returns raw clone pairs. Soft-skips when jscpd cannot run; the lane
 * discloses the gap.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ClonePair {
  fileA: string;
  startA: number;
  endA: number;
  fileB: string;
  startB: number;
  endB: number;
  lines: number;
}

export interface JscpdResult {
  available: boolean;
  clones: ClonePair[];
}

interface JscpdReportFile {
  name: string;
  start: number;
  end: number;
}

interface JscpdReport {
  duplicates?: {
    firstFile: JscpdReportFile;
    secondFile: JscpdReportFile;
    lines: number;
  }[];
}

function normalize(rootPath: string, name: string): string {
  const posixRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const posix = name.replace(/\\/g, "/");
  return posix.startsWith(posixRoot + "/")
    ? posix.slice(posixRoot.length + 1)
    : posix.replace(/^\.\//, "");
}

export function runJscpd(rootPath: string, minLines: number): JscpdResult {
  const outputDir = mkdtempSync(join(tmpdir(), "vibecheck-jscpd-"));
  try {
    const run = spawnSync(
      "npx",
      [
        "jscpd",
        ".",
        `--min-lines=${minLines}`,
        "--min-tokens=50",
        "--reporters=json",
        `--output=${outputDir}`,
        "--silent",
        "--ignore",
        "**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/vendor/**,**/__snapshots__/**,**/*.min.js,**/*.snap",
      ],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: process.platform === "win32",
        maxBuffer: 256 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      },
    );

    const reportPath = join(outputDir, "jscpd-report.json");
    if (!existsSync(reportPath)) {
      if (run.stderr) {
        console.warn(`jscpd produced no report: ${run.stderr.slice(0, 200)}`);
      }
      return { available: false, clones: [] };
    }

    const report = JSON.parse(
      readFileSync(reportPath, "utf-8"),
    ) as JscpdReport;
    const clones: ClonePair[] = (report.duplicates ?? []).map((d) => ({
      fileA: normalize(rootPath, d.firstFile.name),
      startA: d.firstFile.start,
      endA: d.firstFile.end,
      fileB: normalize(rootPath, d.secondFile.name),
      startB: d.secondFile.start,
      endB: d.secondFile.end,
      lines: d.lines,
    }));
    return { available: true, clones };
  } catch (error) {
    console.warn(`jscpd failed: ${error}`);
    return { available: false, clones: [] };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}
