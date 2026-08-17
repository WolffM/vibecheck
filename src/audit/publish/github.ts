/**
 * GitHub sinks (design §6) — the ONLY audit module that touches the
 * GitHub API, wired in exclusively by the action. The core never imports
 * this.
 *
 * Two sinks:
 *  - living issue: one issue, created once, edited in place (marker in
 *    body). Acknowledgment = first ledger event, not issue traffic.
 *  - data-file commit: ledger.jsonl + trends.json pushed to the default
 *    branch with fetch-rebase-retry; on rejection (branch protection)
 *    the run's events ship as a workflow artifact and the report prints
 *    the apply-run instruction.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { LEDGER_PATH } from "../ledger.js";
import { TRENDS_PATH } from "../trends.js";

const FINDINGS_DIR = ".vibecompact/findings";
const BRIEFING_PATH = ".vibecompact/briefing.md";
const MACHINE_PATH = ".vibecompact/audit.json";

export const AUDIT_ISSUE_MARKER = "<!-- vibecompact-living-issue -->";
/** Legacy marker — issues created before the vibeCompact rename. */
export const LEGACY_ISSUE_MARKER = "<!-- vibecheck-audit-living-issue -->";
export const AUDIT_ISSUE_LABEL = "vibecompact";
export const LEGACY_ISSUE_LABEL = "vibecheck-audit";
const AUDIT_ISSUE_TITLE = "vibeCompact";

export const AUDIT_DATA_BRANCH = "vibecompact/data";
export const AUDIT_PR_MARKER = "<!-- vibecompact-data-pr -->";

/** The narrow Octokit surface the sink needs — injectable for tests. */
export interface IssueClient {
  listIssues(params: {
    owner: string;
    repo: string;
    labels: string;
    state: "open";
  }): Promise<{ number: number; body: string | null }[]>;
  createIssue(params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ number: number }>;
  updateIssue(params: {
    owner: string;
    repo: string;
    issue_number: number;
    title?: string;
    body: string;
  }): Promise<void>;
  ensureLabel(params: {
    owner: string;
    repo: string;
    name: string;
    description: string;
  }): Promise<void>;
  addLabels(params: {
    owner: string;
    repo: string;
    issue_number: number;
    labels: string[];
  }): Promise<void>;
  listPulls(params: {
    owner: string;
    repo: string;
    head: string;
    state: "open" | "closed";
  }): Promise<{ number: number; closedAt?: string | null; merged?: boolean }[]>;
  createPull(params: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ number: number }>;
  updatePull(params: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
  }): Promise<void>;
}

export interface PublishIssueResult {
  issueNumber: number;
  created: boolean;
}

/** Create-or-edit the living issue, located by its body marker. */
export async function publishLivingIssue(
  client: IssueClient,
  owner: string,
  repo: string,
  markdown: string,
  footer = "",
): Promise<PublishIssueResult> {
  const body = `${AUDIT_ISSUE_MARKER}\n\n${markdown}${footer ? `\n\n${footer}` : ""}`;

  // Match the current label first, then the pre-rename one so existing
  // issues are adopted (and retitled) rather than duplicated.
  let existing: { number: number; body: string | null } | undefined;
  for (const label of [AUDIT_ISSUE_LABEL, LEGACY_ISSUE_LABEL]) {
    existing = (
      await client.listIssues({ owner, repo, labels: label, state: "open" })
    ).find(
      (issue) =>
        issue.body?.includes(AUDIT_ISSUE_MARKER) ||
        issue.body?.includes(LEGACY_ISSUE_MARKER),
    );
    if (existing) break;
  }

  if (existing) {
    await client.updateIssue({
      owner,
      repo,
      issue_number: existing.number,
      title: AUDIT_ISSUE_TITLE,
      body,
    });
    return { issueNumber: existing.number, created: false };
  }

  await client.ensureLabel({
    owner,
    repo,
    name: AUDIT_ISSUE_LABEL,
    description: "vibeCheck audit living report",
  });
  const created = await client.createIssue({
    owner,
    repo,
    title: AUDIT_ISSUE_TITLE,
    body,
    labels: [AUDIT_ISSUE_LABEL],
  });
  return { issueNumber: created.number, created: true };
}

function git(rootPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: rootPath,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export interface DataFileCommitResult {
  committed: boolean;
  pushed: boolean;
  attempts: number;
}

/**
 * Commit + push the audit data files with fetch-rebase-retry. Returns
 * pushed:false (never throws) when every attempt is rejected — the
 * caller falls back to the artifact + apply-run path.
 */
export function commitDataFiles(
  rootPath: string,
  options: { branch: string; retries?: number; committer?: { name: string; email: string } } ,
): DataFileCommitResult {
  const retries = options.retries ?? 3;
  const paths = [
    LEDGER_PATH,
    TRENDS_PATH,
    FINDINGS_DIR,
    BRIEFING_PATH,
    MACHINE_PATH,
  ].filter((p) => existsSync(join(rootPath, p)));
  if (paths.length === 0) return { committed: false, pushed: true, attempts: 0 };

  // -A so packages deleted by regeneration are staged as deletions too.
  git(rootPath, ["add", "-A", "--", ...paths]);
  const staged = git(rootPath, ["diff", "--cached", "--name-only"]);
  if (!staged) return { committed: false, pushed: true, attempts: 0 };

  const committerArgs = options.committer
    ? [
        "-c",
        `user.name=${options.committer.name}`,
        "-c",
        `user.email=${options.committer.email}`,
      ]
    : [];
  git(rootPath, [
    ...committerArgs,
    "commit",
    "--no-verify",
    "-m",
    "vibecheck: audit data files [skip ci]",
  ]);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      git(rootPath, ["push", "origin", `HEAD:${options.branch}`]);
      return { committed: true, pushed: true, attempts: attempt };
    } catch (error) {
      console.warn(
        `data-file push attempt ${attempt} failed: ${(error as Error).message.split("\n").slice(0, 3).join(" | ")}`,
      );
      try {
        git(rootPath, ["fetch", "origin", options.branch]);
        git(rootPath, [
          ...committerArgs,
          "rebase",
          `origin/${options.branch}`,
        ]);
      } catch (rebaseError) {
        console.warn(
          `data-file rebase failed: ${(rebaseError as Error).message.split("\n").slice(0, 3).join(" | ")}`,
        );
        try {
          git(rootPath, ["rebase", "--abort"]);
        } catch {
          // nothing in progress
        }
        break;
      }
    }
  }
  return { committed: true, pushed: false, attempts: retries };
}

/**
 * Rung two of the delivery ladder: force-push the data commit to the
 * audit-data branch (branch pushes clear protections that block the
 * default branch). The commit already sits on HEAD; protection rejected
 * it for the default branch only.
 */
export function pushDataBranch(rootPath: string): boolean {
  try {
    git(rootPath, [
      "push",
      "--force",
      "origin",
      `HEAD:refs/heads/${AUDIT_DATA_BRANCH}`,
    ]);
    return true;
  } catch (error) {
    console.warn(
      `data-branch push failed: ${(error as Error).message.split("\n").slice(0, 2).join(" | ")}`,
    );
    return false;
  }
}

export interface DataPrResult {
  prNumber: number;
  created: boolean;
}

/**
 * Episodic findings-PR lifecycle (redesign, hadoku_site handoff
 * 2026-08-17). A PR is a triage batch, not a standing surface: it opens
 * only when new findings fired since the last acknowledgment, the
 * maintainer closes it when the batch is triaged, and closure is
 * recorded in the ledger as an `acknowledged` event. The data branch
 * remains the canonical store either way; a quiet run refreshes the
 * branch and touches no PR.
 */

export interface BatchInfo {
  anchor: string | null;
  date: string;
  /** Standing firings newer than the last acknowledgment. */
  newFindings: { fingerprint: string; firedAt: string }[];
  /** The acknowledged PR this batch follows, if any. */
  sincePr: number | null;
}

function batchBody(briefing: string, batch: BatchInfo): string {
  const header =
    `**Findings batch — ${batch.date}` +
    (batch.anchor ? ` · anchor \`${batch.anchor.slice(0, 12)}\`` : "") +
    `** · ${batch.newFindings.length} new finding${batch.newFindings.length === 1 ? "" : "s"}` +
    (batch.sincePr ? ` since #${batch.sincePr} was closed.` : ".");
  return [
    AUDIT_PR_MARKER,
    "",
    header,
    "",
    briefing.trim(),
    "",
    "---",
    "",
    "**How this PR works**",
    "",
    "- The `vibecompact/data` branch is the canonical store; this PR is",
    "  the triage surface for the batch above (evidence packages are",
    "  browsable in the diff under `.vibecompact/findings/`).",
    "- Do **not** merge it — the branch is refreshed in place by every",
    "  audit run, and the ledger already carries every decision.",
    "- **Close this PR when the batch is triaged** (fixes landed and/or",
    "  verdicts filed). Closure is recorded as an acknowledgment; the",
    "  next PR opens only when new findings fire.",
  ].join("\n");
}

/** Refresh the body of an already-open findings PR; null when none. */
export async function refreshOpenDataPr(
  client: IssueClient,
  owner: string,
  repo: string,
  briefing: string,
  batch: BatchInfo,
): Promise<DataPrResult | null> {
  const existing = await client.listPulls({
    owner,
    repo,
    head: `${owner}:${AUDIT_DATA_BRANCH}`,
    state: "open",
  });
  if (existing.length === 0) return null;
  await client.updatePull({
    owner,
    repo,
    pull_number: existing[0].number,
    body: batchBody(briefing, batch),
  });
  return { prNumber: existing[0].number, created: false };
}

/** Open a new findings-batch PR. */
export async function openFindingsBatchPr(
  client: IssueClient,
  owner: string,
  repo: string,
  base: string,
  briefing: string,
  batch: BatchInfo,
): Promise<DataPrResult> {
  const created = await client.createPull({
    owner,
    repo,
    title:
      `vibeCompact findings — ${batch.date}` +
      (batch.anchor ? ` (anchor ${batch.anchor.slice(0, 12)})` : ""),
    head: AUDIT_DATA_BRANCH,
    base,
    body: batchBody(briefing, batch),
  });
  try {
    await client.ensureLabel({
      owner,
      repo,
      name: "do-not-merge",
      description: "vibeCompact findings batch — close when triaged, never merge",
    });
    await client.addLabels({
      owner,
      repo,
      issue_number: created.number,
      labels: ["do-not-merge", AUDIT_ISSUE_LABEL],
    });
  } catch {
    // Labels are a guard, not a requirement.
  }
  return { prNumber: created.number, created: true };
}

/**
 * The most recent findings PR closed after the latest acknowledgment —
 * an acknowledgment the ledger hasn't recorded yet. Merged PRs are
 * ignored (merging is against the contract; nothing to acknowledge).
 */
export async function detectUnrecordedAcknowledgment(
  client: IssueClient,
  owner: string,
  repo: string,
  lastAckAt: string | null,
): Promise<{ prNumber: number; closedAt: string } | null> {
  const closed = await client.listPulls({
    owner,
    repo,
    head: `${owner}:${AUDIT_DATA_BRANCH}`,
    state: "closed",
  });
  const candidates = closed
    .filter((pr) => pr.closedAt && !pr.merged)
    .filter((pr) => !lastAckAt || (pr.closedAt as string) > lastAckAt)
    .sort((a, b) => ((a.closedAt as string) < (b.closedAt as string) ? 1 : -1));
  if (candidates.length === 0) return null;
  return {
    prNumber: candidates[0].number,
    closedAt: candidates[0].closedAt as string,
  };
}

/**
 * Stage the ledger as this run's apply-run events file (dedup on apply
 * makes shipping the whole ledger safe). Returns the artifact path.
 */
export function stageRunArtifact(rootPath: string, runId: string): string {
  const source = join(rootPath, LEDGER_PATH);
  const target = join(rootPath, ".vibecompact", "runs", `${runId}.jsonl`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return target;
}

export function applyRunFooter(runId: string): string {
  return (
    "---\n" +
    `_Data-file push was rejected (branch protection). Apply this run's ` +
    `ledger events locally: download the \`vibecompact-run-${runId}\` ` +
    `artifact to \`.vibecompact/runs/${runId}.jsonl\` and run ` +
    `\`npx vibecheck apply-run ${runId}\`._`
  );
}
