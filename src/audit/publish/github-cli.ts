/**
 * Action-side publish entry: living issue + data-file push. Runs after
 * `vibecheck audit` produced .vibecompact/audit.md in the workspace.
 * Local runs never execute this — the local sink is the core.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import {
  applyRunFooter,
  AUDIT_DATA_BRANCH,
  commitDataFiles,
  publishLivingIssue,
  pushDataBranch,
  stageRunArtifact,
  upsertDataPr,
  type IssueClient,
} from "./github.js";

function makeOctokitClient(token: string): IssueClient {
  const octokit = new Octokit({ auth: token });
  return {
    async listIssues(params) {
      const response = await octokit.issues.listForRepo({
        owner: params.owner,
        repo: params.repo,
        labels: params.labels,
        state: params.state,
        per_page: 100,
      });
      return response.data.map((issue) => ({
        number: issue.number,
        body: issue.body ?? null,
      }));
    },
    async createIssue(params) {
      const response = await octokit.issues.create(params);
      return { number: response.data.number };
    },
    async updateIssue(params) {
      await octokit.issues.update(params);
    },
    async ensureLabel(params) {
      try {
        await octokit.issues.createLabel({
          owner: params.owner,
          repo: params.repo,
          name: params.name,
          description: params.description,
          color: "6f42c1",
        });
      } catch {
        // Label already exists.
      }
    },
    async listPulls(params) {
      const response = await octokit.pulls.list({
        owner: params.owner,
        repo: params.repo,
        head: params.head,
        state: params.state,
        per_page: 10,
      });
      return response.data.map((pr) => ({ number: pr.number }));
    },
    async createPull(params) {
      const response = await octokit.pulls.create(params);
      return { number: response.data.number };
    },
    async updatePull(params) {
      await octokit.pulls.update(params);
    },
  };
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) appendFileSync(outputFile, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let rootPath = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) rootPath = resolve(args[++i]);
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required to publish the audit.");
  const fullRepo = process.env.GITHUB_REPOSITORY;
  if (!fullRepo?.includes("/")) {
    throw new Error("GITHUB_REPOSITORY (owner/repo) is required.");
  }
  const [owner, repo] = fullRepo.split("/");

  const reportPath = join(rootPath, ".vibecompact", "audit.md");
  if (!existsSync(reportPath)) {
    throw new Error(
      `${reportPath} not found — run \`vibecheck audit\` before publishing.`,
    );
  }
  const markdown = readFileSync(reportPath, "utf-8");

  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: rootPath,
    encoding: "utf-8",
  }).trim();

  const push = commitDataFiles(rootPath, {
    branch,
    committer: {
      name: "github-actions[bot]",
      email: "41898282+github-actions[bot]@users.noreply.github.com",
    },
  });

  const client = makeOctokitClient(token);
  let footer = "";
  let channel = "push";
  const runId = process.env.GITHUB_RUN_ID ?? "local";

  if (push.pushed) {
    console.log(
      push.committed
        ? `Data files pushed to ${branch} (attempt ${push.attempts}).`
        : "Data files unchanged — nothing to publish.",
    );
  } else {
    // Rung two: the living data PR (design v0.4 — protected defaults are
    // the user's stated policy, so this is the normal path there).
    console.log(
      `Direct data push rejected after ${push.attempts} attempts — opening the living data PR.`,
    );
    let prDone = false;
    if (pushDataBranch(rootPath)) {
      try {
        const briefingPath = join(rootPath, ".vibecompact", "out", "agent-briefing.md");
        const briefing = existsSync(briefingPath)
          ? readFileSync(briefingPath, "utf-8")
          : `Run \`${runId}\`: data files updated on \`${AUDIT_DATA_BRANCH}\`.`;
        const pr = await upsertDataPr(client, owner, repo, branch, briefing);
        channel = "pr";
        footer = `---\n_Audit data (ledger events, trends, evidence packages) is awaiting merge in #${pr.prNumber}._`;
        setOutput("data_pr", String(pr.prNumber));
        console.log(
          `${pr.created ? "Opened" : "Refreshed"} living data PR #${pr.prNumber}.`,
        );
        prDone = true;
      } catch (error) {
        console.warn(
          `Data PR failed (${(error as Error).message.split("\n")[0]}) — ` +
            "the workflow likely needs `pull-requests: write`. Falling back to artifact.",
        );
      }
    }
    if (!prDone) {
      // Rung three: artifact + apply-run.
      channel = "artifact";
      const artifactPath = stageRunArtifact(rootPath, runId);
      footer = applyRunFooter(runId);
      setOutput("artifact_path", artifactPath);
      console.log(`Run events staged at ${artifactPath}.`);
    }
  }
  setOutput("data_channel", channel);
  setOutput("push_rejected", channel === "push" ? "false" : "true");

  const result = await publishLivingIssue(client, owner, repo, markdown, footer);
  console.log(
    `${result.created ? "Created" : "Updated"} living audit issue #${result.issueNumber}.`,
  );
  setOutput("issue_number", String(result.issueNumber));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
