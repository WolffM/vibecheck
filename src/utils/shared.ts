/**
 * Shared Utilities
 *
 * Common helper functions used across modules.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { Severity } from "../core/types.js";

// ============================================================================
// Constants
// ============================================================================

/** Max buffer size for tool output to prevent memory issues */
export const MAX_OUTPUT_BUFFER = 50 * 1024 * 1024; // 50MB

/** Timeout for tool initialization (e.g., trunk init) */
export const TOOL_INIT_TIMEOUT_MS = 120_000; // 2 minutes

// ============================================================================
// Environment / Repository Helpers
// ============================================================================

/**
 * Run a git command and return the output, or a fallback on failure.
 */
function gitCommand(args: string, fallback: string): string {
  try {
    return execSync(`git ${args}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return fallback;
  }
}

/**
 * Build repository info from GitHub env vars or local git.
 */
export function buildRepoInfo(): {
  owner: string;
  name: string;
  defaultBranch: string;
  commit: string;
} {
  // Try GitHub Actions env vars first
  if (process.env.GITHUB_REPOSITORY) {
    return {
      owner: process.env.GITHUB_REPOSITORY_OWNER || "unknown",
      name: process.env.GITHUB_REPOSITORY.split("/")[1] || "unknown",
      defaultBranch: "main",
      commit: process.env.GITHUB_SHA || "unknown",
    };
  }

  // Fall back to local git detection
  const remoteUrl = gitCommand("config --get remote.origin.url", "");
  let owner = "local";
  let name = "unknown";

  if (remoteUrl) {
    // Parse various remote URL formats:
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // https://dev.azure.com/org/project/_git/repo
    const ghMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    const adoMatch = remoteUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/(.+)/);

    if (ghMatch) {
      owner = ghMatch[1];
      name = ghMatch[2];
    } else if (adoMatch) {
      owner = `${adoMatch[1]}/${adoMatch[2]}`;
      name = decodeURIComponent(adoMatch[3]).replace(/\.git$/, "");
    }
  }

  const commit = gitCommand("rev-parse HEAD", "unknown");
  const branch = gitCommand("rev-parse --abbrev-ref HEAD", "main");

  return { owner, name, defaultBranch: branch, commit };
}

/**
 * Get the current run number from GitHub Actions environment.
 */
export function getRunNumber(): number {
  return parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10);
}

// ============================================================================
// File Helpers
// ============================================================================

/**
 * Load and parse a JSON file with proper error handling.
 * @param path - Path to the JSON file
 * @param fallback - Optional fallback value if file doesn't exist
 * @throws Error if file doesn't exist and no fallback provided
 */
export function loadJsonFile<T>(path: string, fallback?: T): T {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`File not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ============================================================================
// Severity Helpers
// ============================================================================

/**
 * Get a severity emoji for visual distinction.
 */
export function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🔵";
    default:
      return "⚪";
  }
}

/**
 * Map severity to SARIF level.
 */
export function severityToSarifLevel(
  severity: Severity,
): "error" | "warning" | "note" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
    default:
      return "warning";
  }
}

// ============================================================================
// Array Helpers
// ============================================================================

/**
 * Group items by a key function.
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

/**
 * Add an item to a Map of arrays (multimap pattern).
 * Creates the array if the key doesn't exist.
 */
export function addToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Check if two arrays are equal (shallow comparison).
 */
export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// Language Detection
// ============================================================================

/** File extension to language mapping (comprehensive for syntax highlighting) */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  java: "java",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  sh: "bash",
  bash: "bash",
  md: "markdown",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  cpp: "cpp",
  c: "c",
  sql: "sql",
  xml: "xml",
  html: "html",
  css: "css",
};

/** Languages that we track for labeling (subset of all languages) */
const TRACKED_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "python",
  "java",
  "rust",
]);

/**
 * Get language from file extension.
 * @param path - File path to analyze
 * @param forLabeling - If true, only returns tracked languages (typescript/python/java/rust)
 *                      If false, returns syntax highlighting language
 */
export function getLanguageFromPath(
  path: string,
  forLabeling = false,
): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const lang = EXT_TO_LANGUAGE[ext || ""];

  if (!lang) return null;

  if (forLabeling) {
    // For labeling, normalize js to typescript and only return tracked languages
    const normalizedLang = lang === "javascript" ? "typescript" : lang;
    return TRACKED_LANGUAGES.has(normalizedLang) ? normalizedLang : null;
  }

  return lang;
}

/**
 * Map tool name to language for labeling.
 * Returns null for tools that work across languages (semgrep, trunk, jscpd).
 */
export function getToolLanguage(tool: string): string | null {
  const toolLower = tool.toLowerCase();

  // TypeScript/JavaScript tools
  if (["tsc", "eslint", "dependency-cruiser", "knip"].includes(toolLower)) {
    return "typescript";
  }

  // Python tools
  if (["ruff", "mypy", "bandit"].includes(toolLower)) {
    return "python";
  }

  // Java tools
  if (["pmd", "spotbugs"].includes(toolLower)) {
    return "java";
  }

  // Rust tools
  if (["clippy", "cargo-audit", "cargo-deny"].includes(toolLower)) {
    return "rust";
  }

  // Multi-language tools return null
  return null;
}
