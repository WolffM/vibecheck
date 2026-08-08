/**
 * Local sink (design §6) — always runs, every environment.
 *
 * Writes .vibecompact/audit.md (the file analog of the living issue,
 * overwritten in place) and .vibecompact/out/audit.json. The starter setup
 * gitignores both (`.vibecompact/audit.md`, `.vibecompact/out/`); the ledger
 * and trends files stay tracked.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderAgentBriefing } from "../briefing.js";
import { renderFindingPackages } from "../findings.js";
import type { AuditRunResult } from "../index.js";
import { buildMachineResult, renderAuditReport } from "../report.js";

export interface LocalPublishResult {
  reportPath: string;
  machinePath: string;
  briefingPath: string;
  /** Regenerated per-finding packages (tracked, data-file committed). */
  findingsDir: string;
  findingCount: number;
}

export interface LocalPublishOptions {
  /** Write tracked copies (findings/, briefing.md) into the working
   * tree — the CI data-branch path only. Local runs keep generated
   * output under gitignored out/ so a routine `git add -A` never
   * commits regenerated files to the default branch. */
  trackedCopies?: boolean;
}

export function publishLocal(
  result: AuditRunResult,
  options: LocalPublishOptions = {},
): LocalPublishResult {
  const vibecheckDir = join(result.rootPath, ".vibecompact");
  const outDir = join(vibecheckDir, "out");
  mkdirSync(outDir, { recursive: true });

  const reportPath = join(vibecheckDir, "audit.md");
  writeFileSync(reportPath, renderAuditReport(result), "utf-8");

  const machinePath = join(outDir, "audit.json");
  writeFileSync(
    machinePath,
    JSON.stringify(buildMachineResult(result), null, 2) + "\n",
    "utf-8",
  );

  const briefingContent = renderAgentBriefing(result);
  writeFileSync(join(outDir, "agent-briefing.md"), briefingContent, "utf-8");

  // Per-finding packages: regenerate wholesale so resolved findings'
  // packages vanish with them. Tracked copies (data-branch delivery)
  // only on the CI publish path.
  const packages = renderFindingPackages(result);
  const findingsDir = options.trackedCopies
    ? join(vibecheckDir, "findings")
    : join(outDir, "findings");
  rmSync(join(vibecheckDir, "findings"), { recursive: true, force: true });
  rmSync(join(outDir, "findings"), { recursive: true, force: true });
  mkdirSync(findingsDir, { recursive: true });
  for (const [name, content] of packages) {
    writeFileSync(join(findingsDir, name), content, "utf-8");
  }
  const briefingPath = options.trackedCopies
    ? join(vibecheckDir, "briefing.md")
    : join(outDir, "agent-briefing.md");
  if (options.trackedCopies) {
    writeFileSync(briefingPath, briefingContent, "utf-8");
  }

  return {
    reportPath,
    machinePath,
    briefingPath,
    findingsDir,
    findingCount: packages.size,
  };
}
