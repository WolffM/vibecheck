/**
 * Local sink (design §6) — always runs, every environment.
 *
 * Writes .vibecheck/audit.md (the file analog of the living issue,
 * overwritten in place) and .vibecheck/out/audit.json. The starter setup
 * gitignores both (`.vibecheck/audit.md`, `.vibecheck/out/`); the ledger
 * and trends files stay tracked.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderAgentBriefing } from "../briefing.js";
import type { AuditRunResult } from "../index.js";
import { buildMachineResult, renderAuditReport } from "../report.js";

export interface LocalPublishResult {
  reportPath: string;
  machinePath: string;
  briefingPath: string;
}

export function publishLocal(result: AuditRunResult): LocalPublishResult {
  const vibecheckDir = join(result.rootPath, ".vibecheck");
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

  return { reportPath, machinePath, briefingPath };
}
