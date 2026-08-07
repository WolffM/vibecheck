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
    } catch {
      try {
        git(rootPath, ["fetch", "origin", options.branch]);
        git(rootPath, [
          ...committerArgs,
          "rebase",
          `origin/${options.branch}`,
        ]);
      } catch {
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
