/**
 * Tool Utilities
 *
 * Shared helpers for tool execution, including availability checking,
 * running with fallbacks, config file detection, and output parsing.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Types
// ============================================================================

export interface ToolRunOptions {
  cwd: string;
  shell?: boolean;
  maxBuffer?: number;
  encoding?: BufferEncoding;
}

export interface ToolAvailability {
  available: boolean;
  useNpx: boolean;
}

// ============================================================================
// Tool Availability
// ============================================================================

/**
 * Check if a tool is available (try direct command, then npx fallback).
 */
export function isToolAvailable(
  command: string,
  npxFallback = true,
): ToolAvailability {
  // Try direct command first
  const directCheck = spawnSync(command, ["--version"], {
    encoding: "utf-8",
    shell: true,
    stdio: "pipe",
  });

  if (!directCheck.error && directCheck.status === 0) {
    return { available: true, useNpx: false };
  }

  // Try npx fallback if enabled
  if (npxFallback) {
    const npxCheck = spawnSync("npx", [command, "--version"], {
      encoding: "utf-8",
      shell: true,
      stdio: "pipe",
    });

    if (!npxCheck.error && npxCheck.status === 0) {
      return { available: true, useNpx: true };
    }
  }

  return { available: false, useNpx: false };
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Run a tool command with automatic npx fallback.
 */
export function runTool(
  command: string,
  args: string[],
  options: ToolRunOptions & { useNpx?: boolean },
): SpawnSyncReturns<string> {
  const {
    cwd,
    shell = true,
    maxBuffer = 50 * 1024 * 1024,
    encoding = "utf-8",
    useNpx = false,
  } = options;

  const spawnOptions = {
    cwd,
    encoding,
    shell,
    maxBuffer,
  };

  if (useNpx) {
    return spawnSync("npx", [command, ...args], spawnOptions);
  }

  // Try direct command first
  const result = spawnSync(command, args, spawnOptions);

  // If direct command failed, try npx
  if (result.error || (result.status !== 0 && !result.stdout)) {
    return spawnSync("npx", [command, ...args], spawnOptions);
  }

  return result;
}

// ============================================================================
// Config File Detection
// ============================================================================

/**
 * Find the first existing config file from a list of candidates.
 * Returns the filename (not full path) if found, null otherwise.
 */
export function findConfigFile(
  rootPath: string,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    if (existsSync(join(rootPath, candidate))) {
      return candidate;
    }
  }
  return null;
}

// ============================================================================
// Output Parsing
// ============================================================================

/**
 * Safely parse JSON output, returning null on failure.
 */
export function safeParseJson<T>(output: string): T | null {
  try {
    const trimmed = output.trim();
    if (!trimmed) return null;

    // Check if it looks like JSON
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return null;
    }

    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// Directory Utilities
// ============================================================================

/**
 * Find existing directories from a list of common source directories.
 */
export function findSourceDirs(
  rootPath: string,
  candidates?: string[],
): string[] {
  const defaultCandidates = ["src", "lib", "app", "scripts", "packages"];
  const dirs = candidates || defaultCandidates;

  return dirs.filter((dir) => existsSync(join(rootPath, dir)));
}
