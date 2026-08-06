/**
 * CLI entry for `vibecheck audit`.
 *
 * Thin wrapper: parses args, calls the orchestrator, prints the summary.
 * Ledger verbs (justify/wontfix/noise/...) join here in later tasks.
 */

import { runAudit, type AuditOptions } from "./index.js";

function printHelp(): void {
  console.log(`
Usage: vibecheck audit [options]

Runs the code-quality audit and writes .vibecheck/audit.md locally.

Options:
  --root <path>      Root directory to audit (default: cwd)
  --config <path>    Path to vibecheck config file (default: vibecheck.json)
  --gate             Exit early when the repo has been quiet (CI cost guard;
                     plain local runs always execute)
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

  const result = await runAudit(options);

  if (!result.config.enabled) {
    console.log("Audit is disabled in config (audit.enabled: false).");
    return;
  }

  console.log(`vibeCheck Audit (stub — lanes land in upcoming tasks)`);
  console.log(`  Root:        ${result.rootPath}`);
  console.log(
    `  Anchor:      ${result.anchorSha ?? "not a git repository"}` +
      (result.dirty ? " (dirty working tree)" : ""),
  );
  console.log(`  Lanes:       ${result.lanesPlanned.join(", ") || "none"}`);
  console.log(
    `  Files:       ${result.candidateFiles.length} candidates` +
      ` (${result.excluded.length} excluded as generated/vendored)`,
  );
  console.log(`  Size tiers:  ${result.config.sizeTiers.join(" / ")}`);
  const size = result.lanes.size;
  if (size) {
    if (!size.available) {
      console.log(`  Size lane:   ${size.disclosure}`);
    } else {
      const counts = [1, 2, 3].map(
        (t) => size.entries.filter((e) => e.tier === t).length,
      );
      console.log(
        `  Size lane:   ${size.entries.length} files measured — ` +
          `tier1: ${counts[0]}, tier2: ${counts[1]}, tier3: ${counts[2]}` +
          ` (scc ${size.toolVersion ?? "?"})`,
      );
    }
  }
  console.log(`  Report:      ${result.config.reportChannel}`);
}

main().catch((error) => {
  console.error("Audit failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
