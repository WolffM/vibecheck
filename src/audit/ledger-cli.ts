/**
 * Ledger CLI verbs (design §5)
 *
 * justify | wontfix | noise <fingerprint> --reason "..."  → append + local
 * commit; pushes only with --push. floors reset <lane> appends a reset
 * event. ledger show prints the fold. apply-run applies a run's events
 * file (the artifact-download half arrives with the action wiring).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendEvents,
  foldLedger,
  LEDGER_PATH,
  makeUlid,
  pathOf,
  readLedger,
  resolveVerdict,
  floorsForScoring,
  JUSTIFIED_GROWTH_PCT,
  JUSTIFIED_MAX_AGE_DAYS,
  type HumanVerdict,
  type LedgerEvent,
  type VerdictEvent,
} from "./ledger.js";
import { runScc } from "./runners/scc.js";

function git(rootPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitLedger(rootPath: string, message: string, push: boolean): void {
  try {
    git(rootPath, ["add", LEDGER_PATH]);
    git(rootPath, ["commit", "--no-verify", "-m", message]);
    console.log(`Committed: ${message}`);
  } catch (error) {
    console.warn(
      `Ledger updated but not committed (${(error as Error).message.split("\n")[0]}); commit ${LEDGER_PATH} manually.`,
    );
    return;
  }
  if (push) {
    try {
      git(rootPath, ["push"]);
      console.log("Pushed.");
    } catch (error) {
      console.warn(
        `Push failed (${(error as Error).message.split("\n")[0]}); push manually when ready.`,
      );
    }
  }
}

export interface VerdictCliOptions {
  push?: boolean;
  /** Skip the git commit (used by tests and scripted callers). */
  noCommit?: boolean;
}

export function recordVerdict(
  rootPath: string,
  verdict: HumanVerdict,
  fingerprint: string,
  reason: string,
  options: VerdictCliOptions = {},
): VerdictEvent {
  if (!fingerprint.includes(":")) {
    throw new Error(
      `Fingerprint must be <lane>:<path> (e.g. size:src/big.ts), got: ${fingerprint}`,
    );
  }
  const event: VerdictEvent = {
    id: makeUlid(),
    at: new Date().toISOString(),
    verdict,
    fingerprint,
    reason,
  };

  if (verdict === "justified") {
    // Baseline enables growth invalidation; captured best-effort.
    const scc = runScc(rootPath);
    const codeLines = scc.files.find(
      (f) => f.path === pathOf(fingerprint),
    )?.codeLines;
    let sha: string | undefined;
    try {
      sha = git(rootPath, ["rev-parse", "--short", "HEAD"]);
    } catch {
      sha = undefined;
    }
    if (codeLines !== undefined || sha !== undefined) {
      event.baseline = { codeLines, sha };
    }
    event.invalidateWhen = {
      growthPct: JUSTIFIED_GROWTH_PCT,
      maxAgeDays: JUSTIFIED_MAX_AGE_DAYS,
    };
  }

  appendEvents(rootPath, [event]);
  if (!options.noCommit) {
    commitLedger(
      rootPath,
      `vibecheck: ${verdict} ${fingerprint}`,
      options.push ?? false,
    );
  }
  return event;
}

export function resetFloor(
  rootPath: string,
  lane: string,
  options: VerdictCliOptions = {},
): void {
  const event: LedgerEvent = {
    id: makeUlid(),
    at: new Date().toISOString(),
    kind: "floor-reset",
    lane,
  };
  appendEvents(rootPath, [event]);
  if (!options.noCommit) {
    commitLedger(
      rootPath,
      `vibecheck: reset ${lane} floor`,
      options.push ?? false,
    );
  }
  console.log(`Floor reset for lane "${lane}".`);
}

export function applyRun(
  rootPath: string,
  runId: string,
  options: VerdictCliOptions & { file?: string } = {},
): number {
  const file = options.file ?? join(rootPath, ".vibecheck", "runs", `${runId}.jsonl`);
  if (!existsSync(file)) {
    throw new Error(
      `No events file for run ${runId} at ${file}. ` +
        `Download the run artifact there first (or pass --file <path>).`,
    );
  }
  const incoming: LedgerEvent[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as LedgerEvent;
      if (event.id && event.at) incoming.push(event);
    } catch {
      console.warn(`apply-run: skipping unparseable line`);
    }
  }
  const existing = new Set(readLedger(rootPath).map((e) => e.id));
  const fresh = incoming.filter((e) => !existing.has(e.id));
  appendEvents(rootPath, fresh);
  if (fresh.length > 0 && !options.noCommit) {
    commitLedger(
      rootPath,
      `vibecheck: apply run ${runId} (${fresh.length} events)`,
      options.push ?? false,
    );
  }
  console.log(
    `Applied ${fresh.length} events from run ${runId}` +
      (incoming.length !== fresh.length
        ? ` (${incoming.length - fresh.length} already present)`
        : ""),
  );
  return fresh.length;
}

export function showLedger(rootPath: string): void {
  const events = readLedger(rootPath);
  if (events.length === 0) {
    console.log(`No ledger at ${join(rootPath, LEDGER_PATH)}.`);
    return;
  }
  const fold = foldLedger(events);
  let anchorDate: string;
  try {
    anchorDate = git(rootPath, ["log", "-1", "--format=%cI"]);
  } catch {
    anchorDate = new Date().toISOString();
  }

  console.log(`Ledger fold (${fold.events.length} events)\n`);
  if (fold.verdicts.size > 0) {
    console.log("Verdicts:");
    for (const [fingerprint, event] of fold.verdicts) {
      const resolved = resolveVerdict(fold, fingerprint, { anchorDate });
      console.log(
        `  ${fingerprint} — ${resolved.status} (${event.at.slice(0, 10)}): ${event.reason}`,
      );
    }
  }
  const floors = floorsForScoring(fold);
  if (Object.keys(floors).length > 0) {
    console.log("\nStanding floors (attested ratchet):");
    for (const [lane, floor] of Object.entries(floors)) {
      console.log(
        `  ${lane}: ${floor} (${fold.noiseByLane.get(lane)?.size ?? 0} noise attestations)`,
      );
    }
  }
  const active = [...fold.firing.values()].filter((f) => !f.fixedAt);
  const fixed = [...fold.firing.values()].filter((f) => f.fixedAt);
  console.log(`\nFiring: ${active.length} active, ${fixed.length} fixed.`);
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) {
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const [verb, ...rest] = process.argv.slice(2);
  let rootPath = process.cwd();
  let reason = "";
  let push = false;
  let file: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--root" && rest[i + 1]) rootPath = rest[++i];
    else if (arg === "--reason" && rest[i + 1]) reason = rest[++i];
    else if (arg === "--file" && rest[i + 1]) file = rest[++i];
    else if (arg === "--push") push = true;
    else positional.push(arg);
  }

  switch (verb) {
    case "justify":
    case "wontfix":
    case "noise": {
      const verdict: HumanVerdict = verb === "justify" ? "justified" : verb;
      const fingerprint = requireArg(
        positional[0],
        `vibecheck ${verb} <lane>:<path> --reason "..." [--push]`,
      );
      if (!reason) {
        console.error(`A --reason is required for ${verb} verdicts.`);
        process.exit(1);
      }
      const event = recordVerdict(rootPath, verdict, fingerprint, reason, {
        push,
      });
      console.log(`Recorded ${verdict} for ${fingerprint} (${event.id}).`);
      break;
    }
    case "ledger": {
      if (positional[0] !== "show") {
        console.error("Usage: vibecheck ledger show");
        process.exit(1);
      }
      showLedger(rootPath);
      break;
    }
    case "floors": {
      if (positional[0] !== "reset" || !positional[1]) {
        console.error("Usage: vibecheck floors reset <lane>");
        process.exit(1);
      }
      resetFloor(rootPath, positional[1], { push });
      break;
    }
    case "apply-run": {
      const runId = requireArg(
        positional[0],
        "vibecheck apply-run <run-id> [--file <path>]",
      );
      applyRun(rootPath, runId, { push, file });
      break;
    }
    default:
      console.error(`Unknown ledger verb: ${verb}`);
      process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
