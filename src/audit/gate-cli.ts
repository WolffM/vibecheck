/**
 * CLI entry for `vibecheck gate` — evaluates the activity gate and
 * prints a machine-parseable decision. Used by the action's cron path
 * and by anyone scripting cron-like local behavior (design §7).
 *
 * Output contract: human-readable reason lines, then a final
 * `active=true|false` line. Always exits 0 — the decision is the output,
 * not the exit code.
 */

import { loadVibeCopConfig } from "../core/config-loader.js";
import { resolveAuditConfig } from "./config.js";
import { evaluateGate } from "./gate.js";

function main(): void {
  const args = process.argv.slice(2);
  let rootPath = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) rootPath = args[++i];
  }

  const config = resolveAuditConfig(loadVibeCopConfig(rootPath).audit);
  const decision = evaluateGate(rootPath, config);
  console.log(`${decision.reason}: ${decision.detail}`);
  console.log(`active=${decision.active}`);
}

main();
