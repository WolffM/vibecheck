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

const FINDINGS_DIR = ".vibecheck/findings";

export const AUDIT_ISSUE_MARKER = "<!-- vibecheck-audit-living-issue -->";
export const AUDIT_ISSUE_LABEL = "vibecheck-audit";
const AUDIT_ISSUE_TITLE = "vibeCheck Audit";

export const AUDIT_DATA_BRANCH = "vibecheck/audit-data";
export const AUDIT_PR_MARKER = "<!-- vibecheck-audit-data-pr -->";

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
    body: string;
  }): Promise<void>;
  ensureLabel(params: {
    owner: string;
    repo: string;
    name: string;
    description: string;
  }): Promise<void>;
  listPulls(params: {
    owner: string;
    repo: string;
    head: string;
    state: "open";
  }): Promise<{ number: number }[]>;
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

  const existing = (
    await client.listIssues({
      owner,
      repo,
      labels: AUDIT_ISSUE_LABEL,
      state: "open",
    })
  ).find((issue) => issue.body?.includes(AUDIT_ISSUE_MARKER));

  if (existing) {
    await client.updateIssue({
      owner,
      repo,
      issue_number: existing.number,
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
  const paths = [LEDGER_PATH, TRENDS_PATH, FINDINGS_DIR].filter((p) =>
    existsSync(join(rootPath, p)),
  );
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

/** Create-or-refresh the living data PR from the audit-data branch. */
export async function upsertDataPr(
  client: IssueClient,
  owner: string,
  repo: string,
  base: string,
  summary: string,
): Promise<DataPrResult> {
  const body = [
    AUDIT_PR_MARKER,
    "",
    "Audit data from the latest vibeCheck run — machine events for the",
    "ledger, the trends entry, and regenerated per-finding evidence",
    "packages. The branch is force-refreshed from the latest default",
    "branch on every run, so this PR is always current; merge whenever.",
    "",
    summary,
    "",
    "_If required status checks do not trigger on data-only changes,",
    "merge with admin rights or adjust the ruleset for `.vibecheck/**`._",
  ].join("\n");

  const existing = await client.listPulls({
    owner,
    repo,
    head: `${owner}:${AUDIT_DATA_BRANCH}`,
    state: "open",
  });
  if (existing.length > 0) {
    await client.updatePull({
      owner,
      repo,
      pull_number: existing[0].number,
      body,
    });
    return { prNumber: existing[0].number, created: false };
  }
  const created = await client.createPull({
    owner,
    repo,
    title: "vibeCheck: audit data",
    head: AUDIT_DATA_BRANCH,
    base,
    body,
  });
  return { prNumber: created.number, created: true };
}

/**
 * Stage the ledger as this run's apply-run events file (dedup on apply
 * makes shipping the whole ledger safe). Returns the artifact path.
 */
export function stageRunArtifact(rootPath: string, runId: string): string {
  const source = join(rootPath, LEDGER_PATH);
  const target = join(rootPath, ".vibecheck", "runs", `${runId}.jsonl`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return target;
}

export function applyRunFooter(runId: string): string {
  return (
    "---\n" +
    `_Data-file push was rejected (branch protection). Apply this run's ` +
    `ledger events locally: download the \`vibecheck-audit-run-${runId}\` ` +
    `artifact to \`.vibecheck/runs/${runId}.jsonl\` and run ` +
    `\`npx vibecheck apply-run ${runId}\`._`
  );
}
