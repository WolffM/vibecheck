/**
 * Configuration Loader
 *
 * Loads and validates vibecheck configuration files.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Cadence,
  Confidence,
  RepoProfile,
  Severity,
  VibeCopConfig,
} from "./types.js";

// ============================================================================
// Validators
// ============================================================================

/**
 * Validate severity threshold value.
 */
export function isValidSeverityThreshold(
  value: string,
): value is Severity | "info" {
  return ["info", "low", "medium", "high", "critical"].includes(value);
}

/**
 * Validate confidence threshold value.
 */
export function isValidConfidenceThreshold(value: string): value is Confidence {
  return ["low", "medium", "high"].includes(value);
}

// ============================================================================
// YAML Parsing (Simplified)
// ============================================================================

/**
 * Very basic YAML parser for vibecheck.yml structure.
 * For production, use the 'yaml' npm package.
 */
function parseSimpleYaml(content: string): VibeCopConfig {
  // This is a simplified parser - for production use a real YAML library
  const config: VibeCopConfig = { version: 1 };

  try {
    // Remove comments and parse as basic key-value
    // For MVP, just return defaults - config parsing would need yaml package
    const _lines = content.split("\n").filter((l) => !l.trim().startsWith("#"));
    console.log(
      "Note: Full YAML parsing requires yaml package. Using defaults.",
    );
    void _lines; // TODO: implement proper YAML parsing
  } catch {
    // Fallback to defaults
  }

  return config;
}

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Load vibecheck.yml config from repo root.
 */
export function loadVibeCopConfig(
  rootPath: string,
  configPath: string = "vibecheck",
): VibeCopConfig {
  // Try JSON first, then YAML
  const baseName = configPath.replace(/\.(json|yml|yaml)$/, "");
  const jsonPath = join(rootPath, `${baseName}.json`);
  const ymlPath = join(rootPath, `${baseName}.yml`);

  // Try JSON config first
  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, "utf-8");
      console.log(`Loaded config from ${jsonPath}`);
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to parse JSON config: ${error}`);
    }
  }

  // Try YAML config
  if (existsSync(ymlPath)) {
    try {
      const content = readFileSync(ymlPath, "utf-8");
      console.log(`Config file found at ${ymlPath}`);
      return parseSimpleYaml(content);
    } catch (error) {
      console.warn(`Failed to parse YAML config: ${error}`);
    }
  }

  console.log(
    `No config file found at ${jsonPath} or ${ymlPath}, using defaults`,
  );
  return { version: 1 };
}

// ============================================================================
// Tool Enablement
// ============================================================================

/**
 * Determine if a tool should run based on config and cadence.
 */
export function shouldRunTool(
  enabled: boolean | "auto" | Cadence | undefined,
  _profile: RepoProfile,
  currentCadence: Cadence,
  toolDetector: () => boolean,
): boolean {
  if (enabled === false) return false;
  if (enabled === true) return true;

  // Cadence-based enablement
  if (enabled === "daily" || enabled === "weekly" || enabled === "monthly") {
    const cadenceOrder = { daily: 0, weekly: 1, monthly: 2 };
    return cadenceOrder[currentCadence] >= cadenceOrder[enabled];
  }

  // Auto-detect
  if (enabled === "auto" || enabled === undefined) {
    return toolDetector();
  }

  return false;
}

// ============================================================================
// CLI Parsing Helpers
// ============================================================================

/**
 * Parse severity threshold from CLI argument.
 */
export function parseSeverityThreshold(
  value: string | undefined,
  fallback: Severity | "info" = "medium",
): Severity | "info" {
  if (!value) return fallback;
  const lower = value.toLowerCase();
  if (isValidSeverityThreshold(lower)) {
    return lower;
  }
  console.warn(`Invalid severity threshold: ${value}, using ${fallback}`);
  return fallback;
}

/**
 * Parse confidence threshold from CLI argument.
 */
export function parseConfidenceThreshold(
  value: string | undefined,
  fallback: Confidence = "high",
): Confidence {
  if (!value) return fallback;
  const lower = value.toLowerCase();
  if (isValidConfidenceThreshold(lower)) {
    return lower;
  }
  console.warn(`Invalid confidence threshold: ${value}, using ${fallback}`);
  return fallback;
}
