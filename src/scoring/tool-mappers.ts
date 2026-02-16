/**
 * Tool-Specific Severity and Confidence Mappings
 *
 * Maps tool-specific outputs to normalized severity and confidence scores.
 */

import type { Confidence, Severity } from "../core/types.js";

// ============================================================================
// ESLint Mappings
// ============================================================================

/**
 * Map ESLint severity (0=off, 1=warn, 2=error) to our severity scale.
 */
export function mapEslintSeverity(eslintSeverity: 0 | 1 | 2): Severity {
  switch (eslintSeverity) {
    case 2:
      return "high";
    case 1:
      return "medium";
    default:
      return "low";
  }
}

/** High confidence ESLint rules (type-related, definite bugs) */
const ESLINT_HIGH_CONFIDENCE_RULES = [
  "no-undef",
  "no-unused-vars",
  "@typescript-eslint/no-unused-vars",
  "no-dupe-keys",
  "no-duplicate-case",
  "no-unreachable",
  "no-func-assign",
  "no-import-assign",
  "no-const-assign",
  "constructor-super",
  "getter-return",
  "no-class-assign",
  "no-compare-neg-zero",
  "no-cond-assign",
  "no-constant-condition",
  "no-debugger",
  "no-dupe-args",
  "no-dupe-class-members",
  "no-empty-pattern",
  "no-ex-assign",
  "no-fallthrough",
  "no-invalid-regexp",
  "no-obj-calls",
  "no-self-assign",
  "no-setter-return",
  "no-sparse-arrays",
  "no-this-before-super",
  "no-unsafe-negation",
  "use-isnan",
  "valid-typeof",
];

/** Medium confidence ESLint rules (likely issues but context-dependent) */
const ESLINT_MEDIUM_CONFIDENCE_RULES = [
  "eqeqeq",
  "no-eval",
  "no-implied-eval",
  "no-new-func",
  "no-shadow",
  "no-use-before-define",
  "prefer-const",
  "no-var",
  "complexity",
  "max-depth",
  "max-lines-per-function",
];

/**
 * Map ESLint rules to confidence level.
 * Some rules are very reliable (high), others are heuristic (medium/low).
 */
export function mapEslintConfidence(ruleId: string): Confidence {
  if (ESLINT_HIGH_CONFIDENCE_RULES.includes(ruleId)) {
    return "high";
  }
  if (ESLINT_MEDIUM_CONFIDENCE_RULES.includes(ruleId)) {
    return "medium";
  }
  // Default: stylistic/preference rules
  return "low";
}

// ============================================================================
// TypeScript Mappings
// ============================================================================

/**
 * Map TypeScript compiler errors to severity.
 * All tsc errors are considered high severity (they prevent compilation).
 */
export function mapTscSeverity(_code: number): Severity {
  return "high";
}

/**
 * Map TypeScript errors to confidence.
 * TypeScript errors are definitionally high confidence.
 */
export function mapTscConfidence(_code: number): Confidence {
  return "high";
}

// ============================================================================
// jscpd Mappings
// ============================================================================

/**
 * Map jscpd (duplicate code) findings to severity.
 * Based on the size of duplication.
 */
export function mapJscpdSeverity(lines: number, tokens: number): Severity {
  // Large duplications are high severity
  if (lines >= 50 || tokens >= 500) {
    return "high";
  }
  // Medium-sized duplications
  if (lines >= 20 || tokens >= 200) {
    return "medium";
  }
  // Small duplications
  return "low";
}

/**
 * Map jscpd findings to confidence.
 * Exact/near-exact duplicates are high confidence.
 */
export function mapJscpdConfidence(_tokens: number): Confidence {
  // jscpd finds exact duplicates, always high confidence
  return "high";
}

// ============================================================================
// dependency-cruiser Mappings
// ============================================================================

/**
 * Map dependency-cruiser violations to severity.
 */
export function mapDepcruiseSeverity(violationType: string): Severity {
  // Forbidden dependencies are high
  if (violationType === "not-allowed" || violationType === "forbidden") {
    return "high";
  }
  // Circular dependencies are high
  if (violationType === "cycle") {
    return "high";
  }
  // Orphans, unreachable
  if (violationType === "orphan" || violationType === "reachable") {
    return "medium";
  }
  return "medium";
}

/**
 * Map dependency-cruiser findings to confidence.
 */
export function mapDepcruiseConfidence(violationType: string): Confidence {
  // Cycles and forbidden deps are definitive
  if (
    violationType === "cycle" ||
    violationType === "not-allowed" ||
    violationType === "forbidden"
  ) {
    return "high";
  }
  return "medium";
}

// ============================================================================
// knip Mappings
// ============================================================================

/**
 * Map knip (unused code) findings to severity.
 *
 * Severity Rationale:
 *
 * - **dependencies/devDependencies → high**: Unused dependencies add bloat,
 *   increase attack surface (security risk), slow installs, and may have
 *   license implications. These are actionable and should be removed.
 *
 * - **exports/types → medium**: Unused exports indicate dead code that:
 *   1. Confuses developers and AI agents about available APIs
 *   2. Can lead to agents building duplicate functionality (not seeing the
 *      unused code is intentionally available)
 *   3. Increases bundle size in some build configurations
 *   4. Makes refactoring harder (unclear what is actually used)
 *   Medium severity ensures these are surfaced without overwhelming with noise.
 *
 * - **files → medium**: Unused files are similar to unused exports - dead code
 *   that should be cleaned up but isn't immediately dangerous.
 *
 * Note: Some may argue these should be "low" severity. We chose "medium" because
 * unused code is particularly problematic in agentic coding environments where
 * AI assistants may not discover unused structures and build duplicates.
 */
export function mapKnipSeverity(issueType: string): Severity {
  // Unused dependencies are high (bloat, security)
  if (issueType === "dependencies" || issueType === "devDependencies") {
    return "high";
  }
  // Unused exports are medium (dead code, confusing for agents)
  if (issueType === "exports" || issueType === "types") {
    return "medium";
  }
  // Unused files are medium
  if (issueType === "files") {
    return "medium";
  }
  return "medium";
}

/**
 * Map knip findings to confidence.
 */
export function mapKnipConfidence(issueType: string): Confidence {
  // Dependencies are high confidence
  if (issueType === "dependencies" || issueType === "devDependencies") {
    return "high";
  }
  // Exports can have false positives (dynamic usage)
  if (issueType === "exports") {
    return "medium";
  }
  // Unused files are usually accurate
  if (issueType === "files") {
    return "high";
  }
  return "medium";
}

// ============================================================================
// Semgrep Mappings
// ============================================================================

/**
 * Map semgrep findings to severity.
 * Uses semgrep's own severity when available.
 */
export function mapSemgrepSeverity(semgrepSeverity: string): Severity {
  const normalized = semgrepSeverity.toLowerCase();
  if (normalized === "error" || normalized === "high") {
    return "high";
  }
  if (normalized === "warning" || normalized === "medium") {
    return "medium";
  }
  if (normalized === "info" || normalized === "low") {
    return "low";
  }
  return "medium"; // conservative default
}

/**
 * Map semgrep findings to confidence.
 */
export function mapSemgrepConfidence(semgrepConfidence?: string): Confidence {
  if (!semgrepConfidence) {
    return "medium";
  }
  const normalized = semgrepConfidence.toLowerCase();
  if (normalized === "high") {
    return "high";
  }
  if (normalized === "medium") {
    return "medium";
  }
  return "low";
}

// ============================================================================
// Ruff Mappings (Python)
// ============================================================================

/**
 * Map Ruff severity codes to our severity scale.
 * Ruff uses single-letter prefixes: E=error, W=warning, F=pyflakes, etc.
 */
export function mapRuffSeverity(code: string): Severity {
  // E9xx are syntax errors (critical)
  if (code.match(/^E9\d{2}/)) {
    return "critical";
  }
  // F8xx are undefined names, F4xx are import issues (high)
  if (code.match(/^F[48]\d{2}/)) {
    return "high";
  }
  // E (errors) and F (pyflakes) are typically high
  if (code.startsWith("E") || code.startsWith("F")) {
    return "high";
  }
  // S (bandit/security) rules are high to critical
  if (code.startsWith("S")) {
    return "high";
  }
  // W (warnings) are medium
  if (code.startsWith("W")) {
    return "medium";
  }
  // C (complexity), N (naming), D (docstrings) are low
  if (code.startsWith("C") || code.startsWith("N") || code.startsWith("D")) {
    return "low";
  }
  // B (bugbear) rules are medium to high
  if (code.startsWith("B")) {
    return "medium";
  }
  return "medium";
}

/**
 * Map Ruff findings to confidence.
 */
export function mapRuffConfidence(code: string): Confidence {
  // Syntax errors are definite
  if (code.match(/^E9\d{2}/)) {
    return "high";
  }
  // Undefined names, unused imports are definite
  if (code.match(/^F[48]\d{2}/)) {
    return "high";
  }
  // Security rules (S) can have false positives
  if (code.startsWith("S")) {
    return "medium";
  }
  // Most E/F rules are reliable
  if (code.startsWith("E") || code.startsWith("F")) {
    return "high";
  }
  // Style rules are preference-based
  if (code.startsWith("N") || code.startsWith("D")) {
    return "low";
  }
  return "medium";
}

// ============================================================================
// Mypy Mappings (Python)
// ============================================================================

/** High severity Mypy error codes */
const MYPY_HIGH_SEVERITY_CODES = [
  "arg-type",
  "return-value",
  "assignment",
  "call-arg",
  "call-overload",
  "index",
  "attr-defined",
  "name-defined",
  "union-attr",
  "override",
  "operator",
  "misc",
];

/**
 * Map Mypy error codes to severity.
 * Mypy errors are type errors which are generally high severity.
 */
export function mapMypySeverity(errorCode: string): Severity {
  if (MYPY_HIGH_SEVERITY_CODES.some((c) => errorCode.includes(c))) {
    return "high";
  }
  // Import errors are medium
  if (errorCode.includes("import")) {
    return "medium";
  }
  // Note-level issues
  if (errorCode === "note") {
    return "low";
  }
  return "high"; // Default for type checker
}

/**
 * Map Mypy findings to confidence.
 * Type checker findings are typically high confidence.
 */
export function mapMypyConfidence(_errorCode: string): Confidence {
  // Mypy findings are definitive type errors
  return "high";
}

// ============================================================================
// Bandit Mappings (Python)
// ============================================================================

/**
 * Map Bandit severity levels to our scale.
 * Bandit uses LOW, MEDIUM, HIGH severity.
 */
export function mapBanditSeverity(banditSeverity: string): Severity {
  const normalized = banditSeverity.toUpperCase();
  if (normalized === "HIGH") {
    return "critical"; // Security high = critical
  }
  if (normalized === "MEDIUM") {
    return "high";
  }
  return "medium"; // LOW
}

/**
 * Map Bandit confidence levels to our scale.
 * Bandit uses LOW, MEDIUM, HIGH confidence.
 */
export function mapBanditConfidence(banditConfidence: string): Confidence {
  const normalized = banditConfidence.toUpperCase();
  if (normalized === "HIGH") {
    return "high";
  }
  if (normalized === "MEDIUM") {
    return "medium";
  }
  return "low";
}

// ============================================================================
// Vulture Mappings (Python Dead Code)
// ============================================================================

/**
 * Map Vulture finding type to severity.
 * Unused imports and unreachable code are higher severity than unused variables.
 */
export function mapVultureSeverity(code: string): Severity {
  if (code === "unused-import") return "high";
  if (code === "unreachable-code") return "high";
  if (code === "unused-class" || code === "unused-function") return "medium";
  return "low"; // unused-variable, unused-attribute, unused-property
}

/**
 * Map Vulture confidence percentage (60-100) to our confidence scale.
 */
export function mapVultureConfidence(confidencePct: number): Confidence {
  if (confidencePct >= 90) return "high";
  if (confidencePct >= 70) return "medium";
  return "low";
}

// ============================================================================
// PMD Mappings (Java)
// ============================================================================

/**
 * Map PMD priority to severity.
 * PMD uses priority 1-5 (1 = highest, 5 = lowest).
 */
export function mapPmdSeverity(priority: number): Severity {
  if (priority === 1) {
    return "critical";
  }
  if (priority === 2) {
    return "high";
  }
  if (priority === 3) {
    return "medium";
  }
  return "low"; // 4 and 5
}

/**
 * Map PMD findings to confidence based on rule category.
 */
export function mapPmdConfidence(ruleSet: string): Confidence {
  const normalized = ruleSet.toLowerCase();
  // Error-prone rules are high confidence
  if (normalized.includes("errorprone")) {
    return "high";
  }
  // Security rules are medium (can have false positives)
  if (normalized.includes("security")) {
    return "medium";
  }
  // Best practices are medium
  if (normalized.includes("bestpractices")) {
    return "medium";
  }
  // Design/style rules are low
  if (normalized.includes("design") || normalized.includes("codestyle")) {
    return "low";
  }
  return "medium";
}

// ============================================================================
// SpotBugs Mappings (Java)
// ============================================================================

/**
 * Map SpotBugs rank to severity.
 * SpotBugs uses rank 1-20 (1 = scariest, 20 = least scary).
 * Also uses categories: CORRECTNESS, SECURITY, PERFORMANCE, etc.
 */
export function mapSpotBugsSeverity(rank: number, category?: string): Severity {
  // Security issues are always high+
  if (category?.toUpperCase() === "SECURITY") {
    if (rank <= 4) return "critical";
    return "high";
  }
  // Correctness bugs
  if (category?.toUpperCase() === "CORRECTNESS") {
    if (rank <= 4) return "critical";
    if (rank <= 9) return "high";
    return "medium";
  }
  // General rank-based mapping
  if (rank <= 4) {
    return "critical";
  }
  if (rank <= 9) {
    return "high";
  }
  if (rank <= 14) {
    return "medium";
  }
  return "low";
}

/**
 * Map SpotBugs confidence to our scale.
 * SpotBugs uses 1 (high), 2 (medium), 3 (low) for confidence.
 */
export function mapSpotBugsConfidence(confidence: number): Confidence {
  if (confidence === 1) {
    return "high";
  }
  if (confidence === 2) {
    return "medium";
  }
  return "low";
}

// ============================================================================
// Clippy Mappings (Rust)
// ============================================================================

/** High severity Clippy lint categories */
const CLIPPY_HIGH_SEVERITY_LINTS = [
  "clippy::correctness",
  "clippy::suspicious",
  "clippy::unwrap_used",
  "clippy::expect_used",
  "clippy::panic",
  "clippy::todo",
  "clippy::unimplemented",
  "clippy::unreachable",
  "clippy::indexing_slicing",
  "clippy::integer_division",
  "clippy::mem_forget",
  "clippy::multiple_unsafe_ops_per_block",
  "clippy::undocumented_unsafe_blocks",
];

/** Medium severity Clippy lint categories */
const CLIPPY_MEDIUM_SEVERITY_LINTS = [
  "clippy::perf",
  "clippy::complexity",
  "clippy::nursery",
  "clippy::cognitive_complexity",
  "clippy::too_many_arguments",
  "clippy::too_many_lines",
];

/**
 * Map Clippy diagnostic level to severity.
 * Clippy uses error, warning, note, help levels.
 */
export function mapClippySeverity(level: string, lintName?: string): Severity {
  // Check if lint name indicates high severity
  if (lintName) {
    const normalizedLint = lintName.toLowerCase();
    if (CLIPPY_HIGH_SEVERITY_LINTS.some((l) => normalizedLint.includes(l))) {
      return "high";
    }
    if (CLIPPY_MEDIUM_SEVERITY_LINTS.some((l) => normalizedLint.includes(l))) {
      return "medium";
    }
  }

  const normalizedLevel = level.toLowerCase();
  if (normalizedLevel === "error" || normalizedLevel === "ice") {
    return "critical";
  }
  if (normalizedLevel === "warning") {
    return "medium";
  }
  if (normalizedLevel === "note" || normalizedLevel === "help") {
    return "low";
  }
  return "medium";
}

/**
 * Map Clippy findings to confidence.
 * Clippy lints are generally high confidence as they're statically determined.
 */
export function mapClippyConfidence(lintName?: string): Confidence {
  if (!lintName) {
    return "medium";
  }
  const normalizedLint = lintName.toLowerCase();

  // Correctness and suspicious lints are definitive
  if (
    normalizedLint.includes("correctness") ||
    normalizedLint.includes("suspicious")
  ) {
    return "high";
  }
  // Pedantic and style lints may be subjective
  if (
    normalizedLint.includes("pedantic") ||
    normalizedLint.includes("style")
  ) {
    return "medium";
  }
  // Restriction lints are intentionally strict
  if (normalizedLint.includes("restriction")) {
    return "high";
  }
  return "high"; // Default high for Rust's strict type system
}

// ============================================================================
// cargo-audit Mappings (Rust)
// ============================================================================

/**
 * Map cargo-audit CVSS severity to our scale.
 * Uses CVSS score ranges: critical (9.0-10.0), high (7.0-8.9), medium (4.0-6.9), low (0.1-3.9)
 */
export function mapCargoAuditSeverity(severity: string, cvss?: number): Severity {
  // If CVSS score is provided, use it
  if (cvss !== undefined) {
    if (cvss >= 9.0) return "critical";
    if (cvss >= 7.0) return "high";
    if (cvss >= 4.0) return "medium";
    return "low";
  }

  // Fall back to string severity
  const normalized = severity.toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "medium" || normalized === "moderate") return "medium";
  if (normalized === "low") return "low";
  return "medium";
}

/**
 * Map cargo-audit findings to confidence.
 * Advisory database findings are high confidence.
 */
export function mapCargoAuditConfidence(): Confidence {
  // RustSec advisories are vetted and high confidence
  return "high";
}

// ============================================================================
// cargo-deny Mappings (Rust)
// ============================================================================

/**
 * Map cargo-deny diagnostic severity to our scale.
 * cargo-deny categorizes issues into: advisories, bans, licenses, sources
 */
export function mapCargoDenySeverity(
  category: string,
  severity?: string,
): Severity {
  const normalizedCategory = category.toLowerCase();
  const normalizedSeverity = severity?.toLowerCase();

  // Advisory findings use the advisory severity
  if (normalizedCategory === "advisories" || normalizedCategory === "advisory") {
    if (normalizedSeverity === "critical") return "critical";
    if (normalizedSeverity === "high") return "high";
    if (normalizedSeverity === "medium" || normalizedSeverity === "moderate") return "medium";
    if (normalizedSeverity === "low") return "low";
    return "high"; // Default for advisories
  }

  // License violations are high severity
  if (normalizedCategory === "licenses" || normalizedCategory === "license") {
    return "high";
  }

  // Banned crates are high severity
  if (normalizedCategory === "bans" || normalizedCategory === "ban") {
    return "high";
  }

  // Source restrictions are medium
  if (normalizedCategory === "sources" || normalizedCategory === "source") {
    return "medium";
  }

  return "medium";
}

/**
 * Map cargo-deny findings to confidence.
 */
export function mapCargoDenyConfidence(category: string): Confidence {
  const normalizedCategory = category.toLowerCase();

  // Advisory findings are from the RustSec database
  if (normalizedCategory === "advisories" || normalizedCategory === "advisory") {
    return "high";
  }

  // License detection is generally accurate
  if (normalizedCategory === "licenses" || normalizedCategory === "license") {
    return "high";
  }

  // Bans are explicit config, always correct
  if (normalizedCategory === "bans" || normalizedCategory === "ban") {
    return "high";
  }

  // Source checks are definitive
  if (normalizedCategory === "sources" || normalizedCategory === "source") {
    return "high";
  }

  return "medium";
}
