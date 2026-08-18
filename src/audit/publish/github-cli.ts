/**
 * Action-side publish entry: living issue + data-file push. Runs after
 * `vibecheck audit` produced .vibecompact/audit.md in the workspace.
 * Local runs never execute this — the local sink is the core.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import { loadVibeCopConfig } from "../../core/config-loader.js";
import { resolveAuditConfig } from "../config.js";
import { readDataBranchLedger } from "../data-branch.js";
import {
  appendEvents,
  firingsSinceAcknowledged,
  foldLedger,
  makeUlid,
  readLedger,
  writeUnionLedger,
} from "../ledger.js";
import {
  applyRunFooter,
  AUDIT_DATA_BRANCH,
  commitDataFiles,
  detectUnrecordedAcknowledgment,
  openFindingsBatchPr,
  publishesLivingIssue,
  publishLivingIssue,
  pushDataBranch,
  refreshOpenDataPr,
  stageRunArtifact,
  type BatchInfo,
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
    async addLabels(params) {
      await octokit.issues.addLabels(params);
    },
    async listPulls(params) {
      const response = await octokit.pulls.list({
        owner: params.owner,
        repo: params.repo,
        head: params.head,
        state: params.state,
        per_page: 10,
      });
      return response.data.map((pr) => ({
        number: pr.number,
        closedAt: pr.closed_at,
        merged: Boolean(pr.merged_at),
      }));
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

  // The data branch is force-refreshed each run; without this union the
  // push would drop machine events that only ever lived on the branch.
  writeUnionLedger(rootPath, readDataBranchLedger(rootPath));

  const client = makeOctokitClient(token);
  const auditConfig = resolveAuditConfig(loadVibeCopConfig(rootPath).audit);

  // Batch acknowledgment (episodic-PR lifecycle): a findings PR closed
  // since the last acknowledgment means the maintainer has seen that
  // batch. Record it BEFORE committing so the event ships with this run.
  let fold = foldLedger(readLedger(rootPath));
  try {
    const unrecorded = await detectUnrecordedAcknowledgment(
      client,
      owner,
      repo,
      fold.lastAcknowledged?.at ?? null,
    );
    if (unrecorded) {
      appendEvents(rootPath, [
        {
          id: makeUlid(),
          at: unrecorded.closedAt,
          kind: "acknowledged",
          prNumber: unrecorded.prNumber,
        },
      ]);
      fold = foldLedger(readLedger(rootPath));
      console.log(
        `Recorded acknowledgment: findings PR #${unrecorded.prNumber} was closed (${unrecorded.closedAt}).`,
      );
    }
  } catch (error) {
    console.warn(
      `Acknowledgment check failed (${(error as Error).message.split("\n")[0]}) — continuing without it.`,
    );
  }

  const push = commitDataFiles(rootPath, {
    branch,
    committer: {
      name: "github-actions[bot]",
      email: "41898282+github-actions[bot]@users.noreply.github.com",
    },
  });

  let footer = "";
  let channel = "push";
  const runId = process.env.GITHUB_RUN_ID ?? "local";

  // Batch context for PR surfaces, from this run's machine result.
  const machinePath = join(rootPath, ".vibecompact", "out", "audit.json");
  let anchor: string | null = null;
  let anchorDate = "";
  try {
    const machine = JSON.parse(readFileSync(machinePath, "utf-8")) as {
      anchorSha?: string | null;
      anchorDate?: string;
    };
    anchor = machine.anchorSha ?? null;
    anchorDate = (machine.anchorDate ?? "").slice(0, 10);
  } catch {
    // Batch header degrades gracefully without the machine file.
  }
  const batch: BatchInfo = {
    anchor,
    date: anchorDate || "current run",
    newFindings: firingsSinceAcknowledged(fold).map((s) => ({
      fingerprint: s.fingerprint,
      firedAt: s.firedAt,
    })),
    sincePr: fold.lastAcknowledged?.prNumber ?? null,
  };

  if (push.pushed) {
    console.log(
      push.committed
        ? `Data files pushed to ${branch} (attempt ${push.attempts}).`
        : "Data files unchanged — nothing to publish.",
    );
  } else {
    // Expected on protected default branches: GITHUB_TOKEN cannot write
    // them. The data branch is the canonical store; a PR opens only for
    // a new findings batch (episodic lifecycle), never as a standing
    // surface. Grant a default-branch-writing token to use the direct
    // push path instead.
    console.log(
      `Default branch push rejected after ${push.attempts} attempts (protected branch — expected). Delivering via ${AUDIT_DATA_BRANCH}.`,
    );
    let delivered = false;
    if (pushDataBranch(rootPath)) {
      try {
        const briefingPath = join(rootPath, ".vibecompact", "out", "agent-briefing.md");
        const briefing = existsSync(briefingPath)
          ? readFileSync(briefingPath, "utf-8")
          : `Run \`${runId}\`: data files updated on \`${AUDIT_DATA_BRANCH}\`.`;

        const refreshed = await refreshOpenDataPr(client, owner, repo, briefing, batch);
        if (refreshed) {
          channel = "pr";
          footer = `---\n_Findings batch awaiting triage in #${refreshed.prNumber} — close the PR when the batch is triaged._`;
          setOutput("data_pr", String(refreshed.prNumber));
          console.log(`Refreshed open findings PR #${refreshed.prNumber}.`);
        } else if (auditConfig.dataPr === "never") {
          channel = "branch";
          footer = `---\n_Audit data lives on \`${AUDIT_DATA_BRANCH}\` (findings PRs disabled by config)._`;
          console.log("Findings PRs disabled by config — data branch refreshed.");
        } else if (batch.newFindings.length > 0) {
          const pr = await openFindingsBatchPr(client, owner, repo, branch, briefing, batch);
          channel = "pr";
          footer = `---\n_New findings batch awaiting triage in #${pr.prNumber} — close the PR when the batch is triaged._`;
          setOutput("data_pr", String(pr.prNumber));
          console.log(
            `Opened findings batch PR #${pr.prNumber} (${batch.newFindings.length} new finding${batch.newFindings.length === 1 ? "" : "s"}).`,
          );
        } else {
          channel = "branch";
          footer =
            `---\n_Audit data refreshed on \`${AUDIT_DATA_BRANCH}\`; no new findings since the last acknowledged batch` +
            (batch.sincePr ? ` (#${batch.sincePr})` : "") +
            `._`;
          console.log(
            "No new findings since the last acknowledged batch — data branch refreshed, no PR opened.",
          );
        }
        delivered = true;
      } catch (error) {
        console.warn(
          `Findings PR delivery failed (${(error as Error).message.split("\n")[0]}) — ` +
            "the workflow likely needs `pull-requests: write`. Falling back to artifact.",
        );
      }
    }
    if (!delivered) {
      // Last rung: artifact + apply-run.
      channel = "artifact";
      const artifactPath = stageRunArtifact(rootPath, runId);
      footer = applyRunFooter(runId);
      setOutput("artifact_path", artifactPath);
      console.log(`Run events staged at ${artifactPath}.`);
    }
  }
  setOutput("data_channel", channel);
  setOutput("push_rejected", channel === "push" ? "false" : "true");

  // `report_channel: "pr"` means the episodic findings PR IS the report surface,
  // so no standing issue is published. The living issue is a dashboard that never
  // closes; a repo that treats an open issue as "work outstanding" cannot use one,
  // because closing it just makes the next run open a fresh one under a new number.
  // Default stays "issue" — this only opts a repo out.
  if (!publishesLivingIssue(auditConfig.reportChannel)) {
    console.log(
      'report_channel: "pr" — living issue not published; findings ride the episodic PR.',
    );
    setOutput("issue_number", "");
    return;
  }

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
