/**
 * CLI entry for `vibecheck audit`.
 *
 * Thin wrapper: parses args, runs the orchestrator, publishes the local
 * sink (always — design §6), prints a terse summary. Ledger verbs live in
 * ledger-cli.ts.
 */

import { loadVibeCopConfig } from "../core/config-loader.js";
import { resolveAuditConfig } from "./config.js";
import { evaluateGate } from "./gate.js";
import { runAudit, type AuditOptions } from "./index.js";
import { publishLocal } from "./publish/local.js";

function printHelp(): void {
  console.log(`
Usage: vibecheck audit [options]

Runs the vibeCompact audit and writes .vibecompact/audit.md locally.

Options:
  --root <path>      Root directory to audit (default: cwd)
  --config <path>    Path to vibecheck config file (default: vibecheck.json)
  --gate             Consult the activity gate first and skip when quiet
                     (fix-confirmation / volume / staleness paths; plain
                     runs without this flag always execute)
  --help, -h         Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: AuditOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" && args[i + 1]) {
      options.rootPath = args[++i];
    } else if (arg === "--config" && args[i + 1]) {
      options.configPath = args[++i];
    } else if (arg === "--gate") {
      options.gate = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  if (options.gate) {
    const rootPath = options.rootPath ?? process.cwd();
    const config = resolveAuditConfig(
      loadVibeCopConfig(rootPath, options.configPath).audit,
    );
    const decision = evaluateGate(rootPath, config);
    if (!decision.active) {
      console.log(`Gate: quiet — ${decision.detail}. Skipping audit.`);
      return;
    }
    console.log(`Gate: ${decision.reason} — ${decision.detail}`);
  }

  const result = await runAudit(options);

  if (!result.config.enabled) {
    console.log("Audit is disabled in config (audit.enabled: false).");
    return;
  }

  // CI writes tracked copies for the data-branch commit; local runs
  // keep generated output under gitignored out/.
  const { reportPath } = publishLocal(result, {
    trackedCopies: Boolean(process.env.GITHUB_ACTIONS),
  });

  const laneBits: string[] = [];
  for (const lane of result.lanesPlanned) {
    const laneResult = result.lanes[lane as keyof typeof result.lanes];
    if (!laneResult) continue;
    if (!laneResult.available) {
      laneBits.push(`${lane} (skipped)`);
      continue;
    }
    const applicable = laneResult.entries.filter(
      (e) => !("applicable" in e) || e.applicable,
    ).length;
    laneBits.push(`${lane} (${applicable})`);
  }
  const floors = Object.entries(result.ledger.floors);

  console.log(`vibeCompact`);
  console.log(
    `  Anchor:    ${result.anchorSha?.slice(0, 12) ?? "no git"}` +
      (result.dirty ? " (dirty working tree)" : ""),
  );
  console.log(
    `  Files:     ${result.candidateFiles.length} candidates, ` +
      `${result.excluded.length} excluded as generated/vendored`,
  );
  console.log(`  Lanes:     ${laneBits.join(", ") || "none"}`);
  console.log(
    `  Findings:  ${result.worstOffenders.length} worst offenders, ` +
      `${result.bestFirstTargets.length} best-first targets` +
      (result.ledger.suppressed.length > 0
        ? `, ${result.ledger.suppressed.length} suppressed by verdicts`
        : ""),
  );
  if (floors.length > 0) {
    console.log(
      `  Floors:    ` +
        floors.map(([lane, floor]) => `${lane}=${floor}`).join(", "),
    );
  }
  const derivative = result.trends.derivative;
  if (derivative) {
    const sign = derivative.offendersDelta > 0 ? "+" : "";
    console.log(
      `  Trend:     ${sign}${derivative.offendersDelta} offenders since ` +
        `${derivative.baselineAt.slice(0, 10)}` +
        (derivative.trendBreaks.length > 0
          ? ` (⚠ ${derivative.trendBreaks.length} trend breaks)`
          : ""),
    );
  }
  console.log(`  Report:    ${reportPath}`);
}

main().catch((error) => {
  console.error("Audit failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
