/**
 * GitHub API Helpers
 *
 * Provides GitHub API interactions for issue management.
 *
 * Reference: vibeCheck_spec.md sections 8, 12
 */

import { Octokit } from "@octokit/rest";
import type {
  ExistingIssue,
  IssueCreateParams,
  IssueUpdateParams,
} from "../core/types.js";
import {
  extractFingerprintFromBody,
  extractRunMetadata,
} from "../utils/fingerprints.js";

// ============================================================================
// Client Initialization
// ============================================================================

let octokitInstance: Octokit | null = null;

/**
 * Get or create Octokit instance.
 * Uses GITHUB_TOKEN from environment.
 */
function getOctokit(): Octokit {
  if (!octokitInstance) {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      throw new Error(
        "GITHUB_TOKEN or GH_TOKEN environment variable is required",
      );
    }
    octokitInstance = new Octokit({ auth: token });
  }
  return octokitInstance;
}

// ============================================================================
// Issue Search & Fetch
// ============================================================================

/** GitHub API issue shape (common fields we use) */
interface GitHubIssueResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: (string | { name?: string })[];
  pull_request?: unknown;
}

/**
 * Convert a GitHub API issue response to our ExistingIssue type.
 */
function convertToExistingIssue(issue: GitHubIssueResponse): ExistingIssue {
  const existingIssue: ExistingIssue = {
    number: issue.number,
    title: issue.title,
    body: issue.body || "",
    state: issue.state as "open" | "closed",
    labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name || "")),
  };

  // Extract metadata from body
  const fingerprint = extractFingerprintFromBody(existingIssue.body);
  const runMeta = extractRunMetadata(existingIssue.body);

  if (fingerprint) {
    existingIssue.metadata = {
      fingerprint,
      lastSeenRun: runMeta?.run || 0,
      consecutiveMisses: 0, // Will be calculated during processing
    };
  }

  return existingIssue;
}

/**
 * Search for issues with specific label(s).
 * Uses the issues.listForRepo API which is more reliable than the deprecated search API.
 */
export async function searchIssuesByLabel(
  owner: string,
  repo: string,
  labels: string[],
  state: "open" | "closed" | "all" = "open",
): Promise<ExistingIssue[]> {
  // Use the issues list API directly (more reliable, not deprecated)
  return fetchIssuesByLabel(owner, repo, labels, state);
}

/**
 * Fetch issues using the issues API (fallback).
 */
async function fetchIssuesByLabel(
  owner: string,
  repo: string,
  labels: string[],
  state: "open" | "closed" | "all" = "open",
): Promise<ExistingIssue[]> {
  const octokit = getOctokit();
  const issues: ExistingIssue[] = [];

  const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    labels: labels.join(","),
    state,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const issue of response.data) {
      // Filter out pull requests
      if (issue.pull_request) continue;
      issues.push(convertToExistingIssue(issue as GitHubIssueResponse));
    }
  }

  return issues;
}

/**
 * Build a map of fingerprint -> issue for quick lookup.
 */
export function buildFingerprintMap(
  issues: ExistingIssue[],
): Map<string, ExistingIssue> {
  const map = new Map<string, ExistingIssue>();
  for (const issue of issues) {
    if (issue.metadata?.fingerprint) {
      map.set(issue.metadata.fingerprint, issue);
    }
  }
  return map;
}

// ============================================================================
// Issue Creation & Updates
// ============================================================================

/**
 * Create a new issue.
 */
export async function createIssue(
  owner: string,
  repo: string,
  params: IssueCreateParams,
): Promise<number> {
  const octokit = getOctokit();

  const response = await octokit.rest.issues.create({
    owner,
    repo,
    title: params.title,
    body: params.body,
    labels: params.labels,
    assignees: params.assignees,
  });

  return response.data.number;
}

/**
 * Update an existing issue.
 */
export async function updateIssue(
  owner: string,
  repo: string,
  params: IssueUpdateParams,
): Promise<void> {
  const octokit = getOctokit();

  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: params.number,
    title: params.title,
    body: params.body,
    labels: params.labels,
    state: params.state,
  });
}

/**
 * Add a comment to an issue.
 */
export async function addIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const octokit = getOctokit();

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

/**
 * Close an issue with a comment.
 */
export async function closeIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  reason?: string,
): Promise<void> {
  const octokit = getOctokit();

  if (reason) {
    await addIssueComment(owner, repo, issueNumber, reason);
  }

  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: "closed",
    state_reason: "completed",
  });
}

// ============================================================================
// Label Management
// ============================================================================

/**
 * Ensure required labels exist in the repo.
 * Fetches existing labels first to avoid unnecessary API calls and 422 errors.
 */
export async function ensureLabels(
  owner: string,
  repo: string,
  labels: { name: string; color: string; description?: string }[],
): Promise<void> {
  const octokit = getOctokit();

  // Fetch existing labels first to avoid 422 errors
  const existingLabels = new Set<string>();
  try {
    const iterator = octokit.paginate.iterator(
      octokit.rest.issues.listLabelsForRepo,
      {
        owner,
        repo,
        per_page: 100,
      },
    );

    for await (const response of iterator) {
      for (const label of response.data) {
        existingLabels.add(label.name.toLowerCase());
      }
    }
  } catch (error) {
    console.warn(
      "Failed to fetch existing labels, will try to create all:",
      error,
    );
  }

  // Only create labels that don't exist
  const labelsToCreate = labels.filter(
    (label) => !existingLabels.has(label.name.toLowerCase()),
  );

  if (labelsToCreate.length === 0) {
    return; // All labels already exist
  }

  for (const label of labelsToCreate) {
    try {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description,
      });
    } catch (error: unknown) {
      // Label might have been created between our check and now (race condition)
      if ((error as { status?: number }).status !== 422) {
        console.warn(`Failed to create label "${label.name}":`, error);
      }
    }
  }
}

/**
 * Default vibeCheck labels to create.
 */
export const DEFAULT_LABELS = [
  {
    name: "vibeCheck",
    color: "5319e7",
    description: "Created by vibeCheck static analysis",
  },
  {
    name: "severity:critical",
    color: "d73a4a",
    description: "Critical severity finding",
  },
  {
    name: "severity:high",
    color: "e99695",
    description: "High severity finding",
  },
  {
    name: "severity:medium",
    color: "fbca04",
    description: "Medium severity finding",
  },
  {
    name: "severity:low",
    color: "c5def5",
    description: "Low severity finding",
  },
  {
    name: "confidence:high",
    color: "0e8a16",
    description: "High confidence finding",
  },
  {
    name: "confidence:medium",
    color: "bfd4f2",
    description: "Medium confidence finding",
  },
  {
    name: "confidence:low",
    color: "d4c5f9",
    description: "Low confidence finding",
  },
  { name: "autofix:safe", color: "0e8a16", description: "Safe to auto-fix" },
  { name: "layer:code", color: "bfdadc", description: "Code-level finding" },
  {
    name: "layer:architecture",
    color: "d4c5f9",
    description: "Architecture-level finding",
  },
  {
    name: "layer:security",
    color: "d73a4a",
    description: "Security-related finding",
  },
  { name: "tool:eslint", color: "4b32c3", description: "Found by ESLint" },
  { name: "tool:tsc", color: "3178c6", description: "Found by TypeScript" },
  { name: "tool:jscpd", color: "ff6b6b", description: "Found by jscpd" },
  {
    name: "tool:dependency-cruiser",
    color: "00b4d8",
    description: "Found by dependency-cruiser",
  },
  { name: "tool:knip", color: "fca311", description: "Found by Knip" },
  { name: "tool:semgrep", color: "14b8a6", description: "Found by Semgrep" },
  { name: "tool:trunk", color: "10b981", description: "Found by Trunk" },
  // Python tools
  { name: "tool:ruff", color: "d4aa00", description: "Found by Ruff" },
  { name: "tool:mypy", color: "2a6db2", description: "Found by Mypy" },
  { name: "tool:bandit", color: "b91c1c", description: "Found by Bandit" },
  // Java tools
  { name: "tool:pmd", color: "f97316", description: "Found by PMD" },
  { name: "tool:spotbugs", color: "dc2626", description: "Found by SpotBugs" },
  // Language labels (only used when multiple languages have findings)
  { name: "lang:typescript", color: "3178c6", description: "TypeScript finding" },
  { name: "lang:python", color: "3776ab", description: "Python finding" },
  { name: "lang:java", color: "b07219", description: "Java finding" },
];

// ============================================================================
// Repository Info
// ============================================================================

/**
 * Parse repository from GITHUB_REPOSITORY env var.
 */
export function parseGitHubRepository(): {
  owner: string;
  repo: string;
} | null {
  const fullRepo = process.env.GITHUB_REPOSITORY;
  if (!fullRepo) return null;

  const [owner, repo] = fullRepo.split("/");
  if (!owner || !repo) return null;

  return { owner, repo };
}

// ============================================================================
// Rate Limiting Helpers
// ============================================================================

/**
 * Simple delay function for rate limiting.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute with rate limit awareness.
 * Adds delays between API calls to avoid hitting rate limits.
 * Default 500ms is safer for GitHub's secondary rate limits on content creation.
 */
export async function withRateLimit<T>(
  fn: () => Promise<T>,
  delayMs: number = 500,
): Promise<T> {
  const result = await fn();
  await delay(delayMs);
  return result;
}
