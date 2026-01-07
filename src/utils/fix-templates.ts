/**
 * Fix Templates
 *
 * Template-based suggested fixes for common tool findings.
 * Maps tool+ruleId patterns to actionable fix suggestions.
 */

import type { Finding, SuggestedFix, ToolName } from "../core/types.js";

// ============================================================================
// Message Extraction Helpers
// ============================================================================

/**
 * Extract package name from a finding message for security advisories.
 */
function extractPackageFromMessage(message: string): string | null {
  // Match patterns like "'package-name' has..." or "in package-name"
  const match = message.match(/'([^']+)'|in\s+(\S+)/);
  return match ? match[1] || match[2] : null;
}

/**
 * Extract version info from a finding message.
 */
function extractVersionFromMessage(message: string): {
  current: string | null;
  fixed: string | null;
} {
  // Match patterns like:
  // - "Current version is vulnerable: 4.1.0"
  // - "Current version: 4.1.0"
  // - "version: 4.1.0"
  // - "vulnerable version: 4.1.0"
  const currentMatch = message.match(
    /(?:Current version|vulnerable version)[^:]*:\s*(\d+\.\d+[.\d]*)|version:\s*(\d+\.\d+[.\d]*)/i,
  );
  const fixedMatch = message.match(
    /fixed in[:\s]+(\d+\.\d+[.\d]*)|upgrade to[:\s]+(\d+\.\d+[.\d]*)|patched in[:\s]+(\d+\.\d+[.\d]*)/i,
  );
  return {
    current: currentMatch ? currentMatch[1] || currentMatch[2] : null,
    fixed: fixedMatch ? fixedMatch[1] || fixedMatch[2] || fixedMatch[3] : null,
  };
}

// ============================================================================
// Rule-Specific Templates
// ============================================================================

/**
 * Template-based suggested fix generator.
 * Maps tool+ruleId patterns to fix suggestions.
 */
const FIX_TEMPLATES: Record<string, (finding: Finding) => SuggestedFix> = {
  // Security Advisories (GHSA)
  "trunk/GHSA": (finding) => {
    const pkg = extractPackageFromMessage(finding.message);
    const version = extractVersionFromMessage(finding.message);
    return {
      goal: `Fix security vulnerability in ${pkg || "affected package"}`,
      steps: [
        `Identify the vulnerable package: ${pkg || "check the advisory"}`,
        version.current
          ? `Current vulnerable version: ${version.current}`
          : "Check your lockfile for the current version",
        `Review the security advisory: https://github.com/advisories/${finding.ruleId}`,
        version.fixed
          ? `Upgrade to fixed version: ${version.fixed} or later`
          : "Upgrade to the latest patched version",
        "Run `npm update` or `pnpm update` to update the package",
        "Test your application to ensure the update doesn't break functionality",
      ],
      acceptance: [
        "Security scanner no longer flags this vulnerability",
        "Package version is updated in lockfile",
        "Application tests pass",
        "No breaking changes from the update",
      ],
    };
  },

  // Checkov rules for GitHub Actions
  "trunk/CKV_GHA": (finding) => {
    const isWorkflowDispatch = finding.ruleId === "CKV_GHA_7";
    return {
      goal: "Fix GitHub Actions security issue",
      steps: isWorkflowDispatch
        ? [
            "This rule flags `workflow_dispatch` inputs that could affect build outputs",
            "For trusted internal workflows, this may be a false positive",
            "Option 1: Remove workflow_dispatch inputs if not needed",
            "Option 2: Ensure inputs are validated before use",
            "Option 3: Add the file to `.trunk/configs/.checkov.yaml` to ignore this rule",
            "Review: https://www.checkov.io/5.Policy%20Index/CKV_GHA_7.html",
          ]
        : [
            `Review the Checkov rule: ${finding.ruleId}`,
            "Understand the security concern being flagged",
            "Apply the recommended fix from the Checkov documentation",
            "Test that the workflow still functions correctly",
          ],
      acceptance: [
        "Checkov no longer flags this issue",
        "GitHub Actions workflow runs successfully",
        "Security posture is maintained",
      ],
    };
  },

  // Yamllint rules
  "trunk/quoted-strings": () => ({
    goal: "Fix YAML quoted string style",
    steps: [
      "Review the YAML files for inconsistent quoting",
      "Remove unnecessary quotes from simple strings",
      "Keep quotes only where needed (e.g., strings starting with special characters)",
      "Run yamllint to verify the fix",
    ],
    acceptance: [
      "Yamllint reports no quoted-strings violations",
      "YAML files are valid and parseable",
    ],
  }),

  // Shellcheck rules
  "trunk/SC2181": () => ({
    goal: "Check exit code directly instead of using $?",
    steps: [
      "Replace pattern: `command; if [ $? -eq 0 ]` with `if command`",
      "For negation: `if ! command` instead of `if [ $? -ne 0 ]`",
      "This is more readable and avoids issues with intermediate commands",
    ],
    acceptance: [
      "ShellCheck no longer flags SC2181",
      "Script behavior is unchanged",
    ],
  }),

  "trunk/SC2086": () => ({
    goal: "Quote variable expansions to prevent word splitting",
    steps: [
      'Add double quotes around variable expansions: "$variable"',
      "This prevents issues with filenames containing spaces",
      'Arrays should use: "${array[@]}"',
    ],
    acceptance: [
      "ShellCheck no longer flags SC2086",
      "Script handles filenames with spaces correctly",
    ],
  }),

  "trunk/SC3043": () => ({
    goal: "Use POSIX-compatible local variable declaration",
    steps: [
      "The `local` keyword is not POSIX-compliant",
      "Option 1: Change shebang to #!/bin/bash if you need bash features",
      "Option 2: Remove `local` and manage variable scope manually",
      "Option 3: Use a subshell to scope variables: `(var=value; ...)`",
    ],
    acceptance: [
      "ShellCheck no longer flags SC3043",
      "Script runs correctly with the target shell",
    ],
  }),

  // Markdownlint rules
  "trunk/MD036": () => ({
    goal: "Use proper headings instead of emphasis",
    steps: [
      "Replace **Bold Text** used as section headers with proper `## Heading` syntax",
      "Headings provide better document structure and accessibility",
      "Use the appropriate heading level (##, ###, etc.)",
    ],
    acceptance: [
      "Markdownlint no longer flags MD036",
      "Document structure uses proper headings",
    ],
  }),

  "trunk/MD033": () => ({
    goal: "Avoid raw HTML in Markdown",
    steps: [
      "Replace HTML tags with Markdown equivalents where possible",
      "If HTML is necessary, consider if a different approach would work",
      "Some HTML like <details> may be acceptable for GitHub READMEs",
    ],
    acceptance: [
      "Markdownlint no longer flags MD033",
      "Document renders correctly",
    ],
  }),

  "trunk/MD040": () => ({
    goal: "Add language identifier to fenced code blocks",
    steps: [
      "Add language after opening fence: ```javascript instead of just ```",
      "This enables syntax highlighting",
      "Common languages: javascript, typescript, bash, json, yaml",
    ],
    acceptance: [
      "Markdownlint no longer flags MD040",
      "Code blocks have proper syntax highlighting",
    ],
  }),

  // ESLint rules - use shared template for duplicate rules
  "eslint/no-unused-vars": createUnusedVarsTemplate(),
  "eslint/@typescript-eslint/no-unused-vars": createUnusedVarsTemplate(),

  "eslint/prefer-const": () => ({
    goal: "Use const for variables that are never reassigned",
    steps: [
      "Change `let` to `const` for the flagged variable",
      "Verify the variable is indeed never reassigned in its scope",
    ],
    acceptance: ["No prefer-const warnings", "Code compiles without errors"],
  }),

  "eslint/no-var": () => ({
    goal: "Replace var with let or const",
    steps: [
      "Analyze if the variable is reassigned (use let) or not (use const)",
      "Replace var with the appropriate keyword",
      "Check for hoisting issues that var may have masked",
    ],
    acceptance: [
      "No var declarations remain",
      "Tests pass without hoisting-related issues",
    ],
  }),

  // TypeScript errors
  "tsc/TS2304": (finding) => ({
    goal: 'Fix "cannot find name" TypeScript error',
    steps: [
      `Identify what "${finding.message.match(/'([^']+)'/)?.[1] || "the symbol"}" should refer to`,
      "Add missing import statement if it is an external symbol",
      "Define the type/variable if it should exist locally",
      "Check for typos in the symbol name",
    ],
    acceptance: [
      "TypeScript compilation succeeds without this error",
      "The symbol is properly typed",
    ],
  }),

  "tsc/TS2322": () => ({
    goal: "Fix type assignment error",
    steps: [
      "Review the expected type vs the actual type being assigned",
      "Either update the value to match the expected type",
      "Or update the type annotation if the value is correct",
      "Consider if a type guard or assertion is appropriate",
    ],
    acceptance: [
      "TypeScript compilation succeeds",
      "Type safety is maintained (avoid using `any`)",
    ],
  }),

  // jscpd
  "jscpd/duplicate-code": (finding) => ({
    goal: "Eliminate code duplication",
    steps: [
      `Review the duplicate code blocks in: ${finding.locations.map((l) => l.path).join(", ")}`,
      "Identify the common pattern or functionality",
      "Extract the shared logic into a reusable function/module",
      "Replace duplicate occurrences with calls to the shared code",
      "Ensure parameters handle any variations between the original duplicates",
    ],
    acceptance: [
      "Duplicate code detection no longer flags these locations",
      "All tests pass",
      "Code behavior is unchanged",
      "New shared function has appropriate tests",
    ],
  }),

  // dependency-cruiser
  "dependency-cruiser/cycle": (finding) => ({
    goal: "Break circular dependency",
    steps: [
      `Analyze the dependency cycle: ${finding.message}`,
      "Identify the weakest or most inappropriate link in the cycle",
      "Consider these patterns to break the cycle:",
      "  - Extract shared types/interfaces to a separate module",
      "  - Use dependency injection",
      "  - Merge tightly coupled modules",
      "  - Introduce an abstraction layer",
      "Refactor to eliminate the circular reference",
    ],
    acceptance: [
      "No circular dependency detected between these modules",
      "All imports resolve correctly",
      "Tests pass",
      "No new cycles introduced",
    ],
  }),

  "dependency-cruiser/not-allowed": (finding) => ({
    goal: "Remove forbidden dependency",
    steps: [
      `The dependency from ${finding.locations[0]?.path || "source"} violates architecture rules`,
      "Review why this dependency is forbidden (check .dependency-cruiser.js)",
      "Find an alternative approach that respects module boundaries",
      "Consider if the rule should be updated instead (discuss with team)",
    ],
    acceptance: [
      "No forbidden dependency violations",
      "Architecture boundaries are respected",
      "Functionality is preserved",
    ],
  }),

  // knip
  "knip/files": (finding) => ({
    goal: "Remove or utilize unused file",
    steps: [
      `Review ${finding.locations[0]?.path || "the file"} to confirm it is truly unused`,
      "Check if it should be imported somewhere but is not",
      "If genuinely unused, delete the file",
      "Update any documentation references",
    ],
    acceptance: [
      "File is either removed or properly imported",
      "No broken imports",
      "Tests pass",
    ],
  }),

  "knip/dependencies": (finding) => ({
    goal: "Remove unused npm dependency",
    steps: [
      `Verify that ${finding.message.match(/Unused dependency: (.+)/)?.[1] || "the package"} is not used`,
      "Search codebase for any dynamic imports or require calls",
      "Check if it is a peer dependency needed by another package",
      "If truly unused, remove from package.json",
      "Run install to update lockfile",
    ],
    acceptance: [
      "Package is removed from dependencies",
      "Application builds successfully",
      "All features work correctly",
    ],
  }),

  "knip/exports": (finding) => ({
    goal: "Remove or utilize unused export",
    steps: [
      `Check if ${finding.message.match(/Unused export: (.+)/)?.[1] || "the export"} should be used somewhere`,
      "If part of public API, document why it should remain",
      "If truly unused, remove the export keyword or delete the code",
      "Consider if this reveals dead code paths",
    ],
    acceptance: [
      "Export is either removed or documented as intentional API",
      "No broken imports in consuming code",
    ],
  }),
};

// ============================================================================
// Template Factories (for deduplication)
// ============================================================================

/**
 * Create template for unused variables rules (shared by ESLint and TypeScript-ESLint).
 */
function createUnusedVarsTemplate(): () => SuggestedFix {
  return () => ({
    goal: "Remove unused variable declarations",
    steps: [
      "Identify the unused variable from the error message",
      "Determine if the variable should be removed or if it reveals missing functionality",
      "If unused, remove the variable declaration",
      "If needed elsewhere, add the appropriate usage",
    ],
    acceptance: [
      "No unused variable warnings in affected file",
      "Tests continue to pass",
      "No runtime errors from removed code",
    ],
  });
}

// ============================================================================
// Generic Tool Templates
// ============================================================================

/**
 * Generic fix suggestions by tool type.
 */
const GENERIC_TOOL_HINTS: Record<ToolName, (finding: Finding) => SuggestedFix> =
  {
    eslint: (finding) => ({
      goal: `Fix ESLint rule: ${finding.ruleId}`,
      steps: [
        `Review the ESLint documentation for rule "${finding.ruleId}"`,
        "Understand why this rule exists and what it prevents",
        "Apply the suggested fix or refactor code to comply",
        "If rule is inappropriate, consider configuring an exception",
      ],
      acceptance: [
        `No ${finding.ruleId} violations in affected files`,
        "Tests pass",
      ],
    }),
    tsc: (finding) => ({
      goal: `Fix TypeScript error: ${finding.ruleId}`,
      steps: [
        "Read the error message carefully",
        "Check types of all involved expressions",
        "Fix type mismatches or add appropriate type annotations",
        "Avoid using `any` unless absolutely necessary",
      ],
      acceptance: [
        "TypeScript compilation succeeds",
        "Type safety is maintained",
      ],
    }),
    prettier: () => ({
      goal: "Fix formatting issue",
      steps: [
        "Run prettier with --write flag to auto-fix",
        "Or manually adjust formatting to match project style",
      ],
      acceptance: ["Prettier reports no issues", "Code style is consistent"],
    }),
    jscpd: () => ({
      goal: "Reduce code duplication",
      steps: [
        "Identify the duplicated logic",
        "Extract to a shared function or module",
        "Replace duplicates with calls to shared code",
      ],
      acceptance: [
        "Duplication percentage reduced",
        "Tests pass",
        "Behavior unchanged",
      ],
    }),
    "dependency-cruiser": () => ({
      goal: "Fix dependency architecture violation",
      steps: [
        "Review the dependency rule being violated",
        "Understand the architectural intent",
        "Refactor to respect module boundaries",
      ],
      acceptance: [
        "No dependency violations",
        "Architecture constraints respected",
      ],
    }),
    knip: () => ({
      goal: "Clean up unused code",
      steps: [
        "Verify the code/export/dependency is truly unused",
        "Remove if unused, or add proper usage",
        "Update related tests and documentation",
      ],
      acceptance: ["No unused code warnings", "Codebase is cleaner"],
    }),
    semgrep: (finding) => ({
      goal: `Address security/quality issue: ${finding.ruleId}`,
      steps: [
        "Review the semgrep rule documentation",
        "Understand the security or quality concern",
        "Apply the recommended fix pattern",
        "Add tests to prevent regression",
      ],
      acceptance: [
        "Semgrep finding is resolved",
        "Security concern is addressed",
        "Tests verify the fix",
      ],
    }),
    trunk: (finding) => ({
      goal: `Fix linter issue: ${finding.ruleId}`,
      steps: [
        "Review the specific linter rule",
        "Apply appropriate fix",
        "Verify fix does not introduce new issues",
      ],
      acceptance: ["Trunk check passes", "No regressions"],
    }),
    ruff: (finding) => ({
      goal: `Fix Python linting issue: ${finding.ruleId}`,
      steps: [
        `Review the Ruff documentation for rule "${finding.ruleId}"`,
        "Run `ruff check --fix` to auto-fix if available",
        "Manually fix if auto-fix is not available or insufficient",
        "Ensure code follows PEP 8 and project style",
      ],
      acceptance: [
        `No ${finding.ruleId} violations`,
        "Python tests pass",
        "Code style is consistent",
      ],
    }),
    mypy: (finding) => ({
      goal: `Fix Python type error: ${finding.ruleId}`,
      steps: [
        "Read the type error message carefully",
        "Check types of all involved variables and functions",
        "Add type annotations where missing",
        "Fix type mismatches or use appropriate type narrowing",
      ],
      acceptance: [
        "Mypy reports no errors",
        "Type safety is maintained",
        "Tests pass",
      ],
    }),
    bandit: (finding) => ({
      goal: `Address Python security issue: ${finding.ruleId}`,
      steps: [
        `Review the Bandit documentation for "${finding.ruleId}"`,
        "Understand the security vulnerability",
        "Apply secure coding practices to fix the issue",
        "Add tests to verify the security fix",
      ],
      acceptance: [
        "Bandit finding is resolved",
        "Security vulnerability is mitigated",
        "No secrets or credentials exposed",
      ],
    }),
    pmd: (finding) => ({
      goal: `Fix Java code quality issue: ${finding.ruleId}`,
      steps: [
        `Review the PMD documentation for rule "${finding.ruleId}"`,
        "Understand the code quality concern",
        "Refactor code to comply with best practices",
        "Run tests to verify behavior is unchanged",
      ],
      acceptance: [
        `No ${finding.ruleId} violations`,
        "Java tests pass",
        "Code quality improved",
      ],
    }),
    spotbugs: (finding) => ({
      goal: `Fix Java bug pattern: ${finding.ruleId}`,
      steps: [
        `Review the SpotBugs documentation for "${finding.ruleId}"`,
        "Understand the potential bug or vulnerability",
        "Fix the code to eliminate the bug pattern",
        "Add tests to prevent regression",
      ],
      acceptance: [
        "SpotBugs finding is resolved",
        "Potential bug is eliminated",
        "Tests verify correct behavior",
      ],
    }),
    custom: () => ({
      goal: "Address code issue",
      steps: [
        "Review the finding details",
        "Apply appropriate fix",
        "Test the changes",
      ],
      acceptance: ["Issue is resolved", "Tests pass"],
    }),
  };

// ============================================================================
// Public API
// ============================================================================

/**
 * Get suggested fix for a finding.
 * Falls back to generic templates if no specific one exists.
 */
export function getSuggestedFix(finding: Finding): SuggestedFix {
  // Try exact match
  const exactKey = `${finding.tool}/${finding.ruleId}`;
  if (FIX_TEMPLATES[exactKey]) {
    return FIX_TEMPLATES[exactKey](finding);
  }

  // Try tool-level patterns (partial match on rule ID)
  for (const [pattern, generator] of Object.entries(FIX_TEMPLATES)) {
    const [tool, rulePattern] = pattern.split("/");
    if (
      finding.tool === tool &&
      finding.ruleId.toLowerCase().includes(rulePattern.toLowerCase())
    ) {
      return generator(finding);
    }
  }

  // Generic fallback based on tool
  return getGenericFix(finding);
}

/**
 * Generate a generic fix suggestion based on tool type.
 */
function getGenericFix(finding: Finding): SuggestedFix {
  const generator =
    GENERIC_TOOL_HINTS[finding.tool] || GENERIC_TOOL_HINTS.custom;
  return generator(finding);
}
