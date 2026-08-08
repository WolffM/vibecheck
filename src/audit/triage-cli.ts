/**
 * `vibecheck triage` — the fast human step between audit and handoff.
 *
 * Walks gate-passing findings one file at a time; each keypress either
 * leaves the finding for the fixing agent or files a verdict. Emits the
 * ledger events and the refreshed agent briefing together, so a triage
 * session ends with both sides of the decision packaged.
 */

import { createInterface } from "node:readline/promises";
import { runAudit } from "./index.js";
import { recordVerdict } from "./ledger-cli.js";
import { publishLocal } from "./publish/local.js";
import type { HumanVerdict } from "./ledger.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let rootPath = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) rootPath = args[++i];
  }

  console.log("Running audit...");
  const result = await runAudit({ rootPath });
  const findings = result.worstOffenders;
  if (findings.length === 0) {
    console.log("Nothing passes the gate — no triage needed.");
    publishLocal(result);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let filed = 0;
  console.log(
    `\n${findings.length} gate-passing findings. Per lane: [enter] keep for fixing · n noise · w wontfix · j justify · q quit\n`,
  );

  outer: for (const [index, offender] of findings.entries()) {
    console.log(
      `\n${index + 1}/${findings.length} ${offender.path}` +
        `\n  firing: ${offender.firingLanes.map((f) => f.lane).join(" + ")}`,
    );
    for (const firing of offender.firingLanes) {
      const answer = (
        await rl.question(`  ${firing.lane} → [keep/n/w/j/q] `)
      ).trim();
      if (answer === "q") break outer;
      if (!["n", "w", "j"].includes(answer)) continue;
      const verdict: HumanVerdict =
        answer === "n" ? "noise" : answer === "w" ? "wontfix" : "justified";
      const reason = (
        await rl.question(`    reason: `)
      ).trim();
      if (!reason) {
        console.log("    (no reason — skipped; verdicts need reasons)");
        continue;
      }
      recordVerdict(
        rootPath,
        verdict,
        `${firing.lane}:${offender.path}`,
        reason,
        { noCommit: true },
      );
      filed++;
    }
  }
  rl.close();

  if (filed > 0) {
    console.log(`\n${filed} verdict(s) appended to .vibecompact/ledger.jsonl.`);
    console.log("Re-running audit to fold them in...");
    const refreshed = await runAudit({ rootPath });
    const { reportPath } = publishLocal(refreshed);
    console.log(
      `Report + agent briefing refreshed (${reportPath}). ` +
        "Commit .vibecompact/ledger.jsonl to make the verdicts durable.",
    );
  } else {
    publishLocal(result);
    console.log("\nNo verdicts filed; briefing written from current findings.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
