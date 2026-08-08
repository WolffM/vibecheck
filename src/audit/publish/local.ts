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

export function publishLocal(result: AuditRunResult): LocalPublishResult {
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

  const briefingPath = join(outDir, "agent-briefing.md");
  writeFileSync(briefingPath, renderAgentBriefing(result), "utf-8");

  // Per-finding packages: regenerate wholesale so resolved findings'
  // packages vanish with them.
  const findingsDir = join(vibecheckDir, "findings");
  rmSync(findingsDir, { recursive: true, force: true });
  const packages = renderFindingPackages(result);
  mkdirSync(findingsDir, { recursive: true });
  for (const [name, content] of packages) {
    writeFileSync(join(findingsDir, name), content, "utf-8");
  }

  return {
    reportPath,
    machinePath,
    briefingPath,
    findingsDir,
    findingCount: packages.size,
  };
}
