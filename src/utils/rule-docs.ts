/**
 * Rule Documentation URLs
 *
 * Maps tool rules to their documentation URLs.
 */

// ============================================================================
// Yamllint Rules
// ============================================================================

const YAMLLINT_RULES = [
  "braces",
  "brackets",
  "colons",
  "commas",
  "comments",
  "comments-indentation",
  "document-end",
  "document-start",
  "empty-lines",
  "empty-values",
  "float-values",
  "hyphens",
  "indentation",
  "key-duplicates",
  "key-ordering",
  "line-length",
  "new-line-at-end-of-file",
  "new-lines",
  "octal-values",
  "quoted-strings",
  "trailing-spaces",
  "truthy",
];

// ============================================================================
// Documentation URL Generators
// ============================================================================

/**
 * Get the documentation URL for a rule ID.
 */
export function getRuleDocUrl(tool: string, ruleId: string): string | null {
  // Handle trunk sublinter rules - extract the actual linter from rule context
  if (tool === "trunk") {
    return getTrunkRuleDocUrl(ruleId);
  }

  // ESLint rules (direct, not via trunk)
  if (tool === "eslint") {
    return getEslintRuleDocUrl(ruleId);
  }

  // Semgrep rules
  if (tool === "semgrep") {
    return `https://semgrep.dev/r?q=${encodeURIComponent(ruleId)}`;
  }

  // Ruff rules
  if (tool === "ruff") {
    return `https://docs.astral.sh/ruff/rules/${ruleId}`;
  }

  // Mypy error codes
  if (tool === "mypy") {
    return `https://mypy.readthedocs.io/en/stable/error_code_list.html`;
  }

  // Bandit rules
  if (tool === "bandit" && ruleId.match(/^B\d{3}$/)) {
    return `https://bandit.readthedocs.io/en/latest/plugins/${ruleId.toLowerCase()}_${ruleId.toLowerCase()}.html`;
  }

  // PMD rules
  if (tool === "pmd") {
    return `https://pmd.github.io/latest/pmd_rules_java.html`;
  }

  // SpotBugs rules
  if (tool === "spotbugs") {
    return `https://spotbugs.readthedocs.io/en/stable/bugDescriptions.html`;
  }

  return null;
}

// ============================================================================
// Tool-Specific Helpers
// ============================================================================

/**
 * Get doc URL for trunk sublinter rules.
 */
function getTrunkRuleDocUrl(ruleId: string): string | null {
  // Check for GHSA (GitHub Security Advisory) - from osv-scanner
  if (ruleId.startsWith("GHSA-")) {
    return `https://github.com/advisories/${ruleId}`;
  }
  // Check for CVE
  if (ruleId.startsWith("CVE-")) {
    return `https://nvd.nist.gov/vuln/detail/${ruleId}`;
  }
  // Check for CWE
  if (ruleId.startsWith("CWE-")) {
    return `https://cwe.mitre.org/data/definitions/${ruleId.replace("CWE-", "")}.html`;
  }
  // Check for Checkov rules
  if (ruleId.startsWith("CKV_")) {
    return `https://www.checkov.io/5.Policy%20Index/${ruleId}.html`;
  }
  // Markdownlint rules (MD001, MD002, etc.)
  if (ruleId.match(/^MD\d{3}$/)) {
    return `https://github.com/DavidAnson/markdownlint/blob/main/doc/md${ruleId.replace("MD", "").padStart(3, "0")}.md`;
  }
  // Shellcheck rules (SC1000, SC2000, etc.)
  if (ruleId.match(/^SC\d{4}$/)) {
    return `https://www.shellcheck.net/wiki/${ruleId}`;
  }
  // Yamllint rules
  if (YAMLLINT_RULES.includes(ruleId)) {
    return `https://yamllint.readthedocs.io/en/stable/rules.html#module-yamllint.rules.${ruleId.replace(/-/g, "_")}`;
  }
  // Prettier - no specific rule docs
  if (ruleId === "prettier") {
    return `https://prettier.io/docs/en/options.html`;
  }
  // ESLint rules via trunk
  if (ruleId.match(/^[a-z][a-z-]*$/)) {
    return `https://eslint.org/docs/rules/${ruleId}`;
  }
  // TypeScript ESLint rules
  if (ruleId.startsWith("@typescript-eslint/")) {
    return `https://typescript-eslint.io/rules/${ruleId.replace("@typescript-eslint/", "")}`;
  }

  return null;
}

/**
 * Get doc URL for ESLint rules.
 */
function getEslintRuleDocUrl(ruleId: string): string | null {
  if (ruleId.match(/^[a-z-]+$/)) {
    return `https://eslint.org/docs/rules/${ruleId}`;
  }
  if (ruleId.startsWith("@typescript-eslint/")) {
    return `https://typescript-eslint.io/rules/${ruleId.replace("@typescript-eslint/", "")}`;
  }
  return null;
}
