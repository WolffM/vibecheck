/**
 * Effort Estimation
 *
 * Estimates effort to fix findings based on tool, rule, and context.
 */

import type { Effort, ToolName } from "../types.js";

/**
 * Estimate effort to fix a finding.
 *
 * S (Small): Quick fix, often autofix available, single location
 * M (Medium): Requires some thought, multiple changes, or investigation
 * L (Large): Significant refactoring, architectural changes
 */
export function estimateEffort(
  tool: ToolName,
  ruleId: string,
  locationCount: number,
  hasAutofix: boolean,
): Effort {
  // Autofix available = Small effort
  if (hasAutofix) {
    return "S";
  }

  // Multiple locations = at least Medium
  if (locationCount > 3) {
    return "L";
  }
  if (locationCount > 1) {
    return "M";
  }

  // Tool-specific heuristics
  if (tool === "jscpd") {
    // Duplicate code refactoring is typically Medium to Large
    return "M";
  }

  if (tool === "dependency-cruiser") {
    // Fixing dependency cycles is typically Large
    if (ruleId.toLowerCase().includes("cycle")) {
      return "L";
    }
    return "M";
  }

  if (tool === "knip") {
    // Removing unused code is typically Small
    return "S";
  }

  if (tool === "tsc") {
    // Type errors can vary; assume Medium without more info
    return "M";
  }

  // ESLint/Prettier - typically Small if single location
  if (tool === "eslint" || tool === "prettier") {
    return "S";
  }

  // Python tools
  if (tool === "ruff") {
    // Ruff has autofix for many rules; if we get here, no autofix
    // Style rules (N, D) are Small, others Medium
    if (ruleId.startsWith("N") || ruleId.startsWith("D")) {
      return "S";
    }
    return "M";
  }

  if (tool === "mypy") {
    // Type errors vary; assume Medium
    return "M";
  }

  if (tool === "bandit") {
    // Security issues vary widely
    // Hardcoded passwords/secrets are typically Small (remove/externalize)
    if (
      ruleId.includes("hardcoded") ||
      ruleId.includes("B105") ||
      ruleId.includes("B106")
    ) {
      return "S";
    }
    // Most security fixes require investigation
    return "M";
  }

  // Java tools
  if (tool === "pmd") {
    // PMD covers wide range; default to Medium
    const ruleIdLower = ruleId.toLowerCase();
    if (ruleIdLower.includes("unused") || ruleIdLower.includes("empty")) {
      return "S";
    }
    return "M";
  }

  if (tool === "spotbugs") {
    // SpotBugs findings typically require investigation
    return "M";
  }

  // Default: Medium
  return "M";
}
