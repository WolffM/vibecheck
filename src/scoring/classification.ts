/**
 * Layer Classification
 *
 * Classifies findings into layers: security, code, architecture, system.
 */

import type { Layer, ToolName } from "../core/types.js";

/** Patterns that indicate security-related issues */
const SECURITY_PATTERNS = [
  "security",
  "xss",
  "injection",
  "csrf",
  "sql",
  "xxe",
  "ssrf",
  "auth",
  "crypto",
  "secret",
  "password",
  "eval",
  "dangerous",
  "hardcoded",
  "random",
  "prototype",
  "pollution",
  "vulnerable",
];

/**
 * Classify a finding into a layer based on tool and rule.
 */
export function classifyLayer(tool: ToolName, ruleId: string): Layer {
  // Security tools are always security layer
  if (tool === "bandit" || tool === "spotbugs") {
    // SpotBugs can have non-security findings
    const ruleIdLower = ruleId.toLowerCase();
    if (
      tool === "spotbugs" &&
      !ruleIdLower.includes("security") &&
      !ruleIdLower.includes("sql") &&
      !ruleIdLower.includes("xss")
    ) {
      return "code";
    }
    return "security";
  }

  // GitHub Security Advisories and CVEs are always security
  if (
    ruleId.startsWith("GHSA-") ||
    ruleId.startsWith("CVE-") ||
    ruleId.startsWith("CWE-")
  ) {
    return "security";
  }

  // Checkov rules (CKV_*) are security - GitHub Actions, Terraform, etc.
  if (ruleId.startsWith("CKV_")) {
    return "security";
  }

  // osv-scanner findings (from Trunk) are security
  if (tool === "trunk" && (ruleId.includes("GHSA") || ruleId.includes("CVE"))) {
    return "security";
  }

  // Check for security patterns in rule ID
  const ruleIdLower = ruleId.toLowerCase();
  if (SECURITY_PATTERNS.some((p) => ruleIdLower.includes(p))) {
    return "security";
  }

  // Ruff security rules (S prefix)
  if (tool === "ruff" && ruleId.startsWith("S")) {
    return "security";
  }

  // Architecture layer
  if (tool === "dependency-cruiser" || tool === "knip") {
    return "architecture";
  }
  if (
    ruleIdLower.includes("import") ||
    ruleIdLower.includes("dependency") ||
    ruleIdLower.includes("cycle")
  ) {
    return "architecture";
  }

  // System layer (build, config issues)
  if (tool === "tsc" || tool === "mypy") {
    // Type errors are code-level
    return "code";
  }

  // Default: code layer
  return "code";
}
