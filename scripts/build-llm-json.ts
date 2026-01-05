/**
 * LLM JSON Builder
 *
 * Converts internal Finding[] model to LLM-friendly JSON format.
 * Includes suggested fixes, acceptance criteria, and deterministic ordering.
 *
 * Reference: vibeCop_spec.md section 6.2
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { compareFindingsForSort, meetsThresholds } from './scoring.js';
import type {
  Confidence,
  Finding,
  LlmJsonOutput,
  LlmJsonSummary,
  RunContext,
  Severity,
  SuggestedFix,
  ToolName,
} from './types.js';

// ============================================================================
// Suggested Fix Templates
// ============================================================================

/**
 * Template-based suggested fix generator.
 * Maps tool+ruleId patterns to fix suggestions.
 */
const FIX_TEMPLATES: Record<string, (finding: Finding) => SuggestedFix> = {
  // ESLint rules
  'eslint/no-unused-vars': () => ({
    goal: 'Remove unused variable declarations',
    steps: [
      'Identify the unused variable from the error message',
      'Determine if the variable should be removed or if it reveals missing functionality',
      'If unused, remove the variable declaration',
      'If needed elsewhere, add the appropriate usage',
    ],
    acceptance: [
      'No unused variable warnings in affected file',
      'Tests continue to pass',
      'No runtime errors from removed code',
    ],
  }),

  'eslint/@typescript-eslint/no-unused-vars': () => ({
    goal: 'Remove unused variable declarations',
    steps: [
      'Identify the unused variable from the error message',
      'Determine if the variable should be removed or if it reveals missing functionality',
      'If unused, remove the variable declaration',
      'If needed elsewhere, add the appropriate usage',
    ],
    acceptance: [
      'No unused variable warnings in affected file',
      'Tests continue to pass',
      'No runtime errors from removed code',
    ],
  }),

  'eslint/prefer-const': () => ({
    goal: 'Use const for variables that are never reassigned',
    steps: [
      'Change `let` to `const` for the flagged variable',
      'Verify the variable is indeed never reassigned in its scope',
    ],
    acceptance: [
      'No prefer-const warnings',
      'Code compiles without errors',
    ],
  }),

  'eslint/no-var': () => ({
    goal: 'Replace var with let or const',
    steps: [
      'Analyze if the variable is reassigned (use let) or not (use const)',
      'Replace var with the appropriate keyword',
      'Check for hoisting issues that var may have masked',
    ],
    acceptance: [
      'No var declarations remain',
      'Tests pass without hoisting-related issues',
    ],
  }),

  // TypeScript errors
  'tsc/TS2304': (finding) => ({
    goal: 'Fix "cannot find name" TypeScript error',
    steps: [
      `Identify what "${finding.message.match(/'([^']+)'/)?.[1] || 'the symbol'}" should refer to`,
      'Add missing import statement if it is an external symbol',
      'Define the type/variable if it should exist locally',
      'Check for typos in the symbol name',
    ],
    acceptance: [
      'TypeScript compilation succeeds without this error',
      'The symbol is properly typed',
    ],
  }),

  'tsc/TS2322': () => ({
    goal: 'Fix type assignment error',
    steps: [
      'Review the expected type vs the actual type being assigned',
      'Either update the value to match the expected type',
      'Or update the type annotation if the value is correct',
      'Consider if a type guard or assertion is appropriate',
    ],
    acceptance: [
      'TypeScript compilation succeeds',
      'Type safety is maintained (avoid using `any`)',
    ],
  }),

  // jscpd
  'jscpd/duplicate-code': (finding) => ({
    goal: 'Eliminate code duplication',
    steps: [
      `Review the duplicate code blocks in: ${finding.locations.map((l) => l.path).join(', ')}`,
      'Identify the common pattern or functionality',
      'Extract the shared logic into a reusable function/module',
      'Replace duplicate occurrences with calls to the shared code',
      'Ensure parameters handle any variations between the original duplicates',
    ],
    acceptance: [
      'Duplicate code detection no longer flags these locations',
      'All tests pass',
      'Code behavior is unchanged',
      'New shared function has appropriate tests',
    ],
  }),

  // dependency-cruiser
  'dependency-cruiser/cycle': (finding) => ({
    goal: 'Break circular dependency',
    steps: [
      `Analyze the dependency cycle: ${finding.message}`,
      'Identify the weakest or most inappropriate link in the cycle',
      'Consider these patterns to break the cycle:',
      '  - Extract shared types/interfaces to a separate module',
      '  - Use dependency injection',
      '  - Merge tightly coupled modules',
      '  - Introduce an abstraction layer',
      'Refactor to eliminate the circular reference',
    ],
    acceptance: [
      'No circular dependency detected between these modules',
      'All imports resolve correctly',
      'Tests pass',
      'No new cycles introduced',
    ],
  }),

  'dependency-cruiser/not-allowed': (finding) => ({
    goal: 'Remove forbidden dependency',
    steps: [
      `The dependency from ${finding.locations[0]?.path || 'source'} violates architecture rules`,
      'Review why this dependency is forbidden (check .dependency-cruiser.js)',
      'Find an alternative approach that respects module boundaries',
      'Consider if the rule should be updated instead (discuss with team)',
    ],
    acceptance: [
      'No forbidden dependency violations',
      'Architecture boundaries are respected',
      'Functionality is preserved',
    ],
  }),

  // knip
  'knip/files': (finding) => ({
    goal: 'Remove or utilize unused file',
    steps: [
      `Review ${finding.locations[0]?.path || 'the file'} to confirm it is truly unused`,
      'Check if it should be imported somewhere but is not',
      'If genuinely unused, delete the file',
      'Update any documentation references',
    ],
    acceptance: [
      'File is either removed or properly imported',
      'No broken imports',
      'Tests pass',
    ],
  }),

  'knip/dependencies': (finding) => ({
    goal: 'Remove unused npm dependency',
    steps: [
      `Verify that ${finding.message.match(/Unused dependency: (.+)/)?.[1] || 'the package'} is not used`,
      'Search codebase for any dynamic imports or require calls',
      'Check if it is a peer dependency needed by another package',
      'If truly unused, remove from package.json',
      'Run install to update lockfile',
    ],
    acceptance: [
      'Package is removed from dependencies',
      'Application builds successfully',
      'All features work correctly',
    ],
  }),

  'knip/exports': (finding) => ({
    goal: 'Remove or utilize unused export',
    steps: [
      `Check if ${finding.message.match(/Unused export: (.+)/)?.[1] || 'the export'} should be used somewhere`,
      'If part of public API, document why it should remain',
      'If truly unused, remove the export keyword or delete the code',
      'Consider if this reveals dead code paths',
    ],
    acceptance: [
      'Export is either removed or documented as intentional API',
      'No broken imports in consuming code',
    ],
  }),
};

/**
 * Get suggested fix for a finding.
 * Falls back to generic templates if no specific one exists.
 */
function getSuggestedFix(finding: Finding): SuggestedFix {
  // Try exact match
  const exactKey = `${finding.tool}/${finding.ruleId}`;
  if (FIX_TEMPLATES[exactKey]) {
    return FIX_TEMPLATES[exactKey](finding);
  }

  // Try tool-level patterns
  for (const [pattern, generator] of Object.entries(FIX_TEMPLATES)) {
    const [tool, rulePattern] = pattern.split('/');
    if (finding.tool === tool && finding.ruleId.toLowerCase().includes(rulePattern.toLowerCase())) {
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
  const toolHints: Record<ToolName, SuggestedFix> = {
    eslint: {
      goal: `Fix ESLint rule: ${finding.ruleId}`,
      steps: [
        `Review the ESLint documentation for rule "${finding.ruleId}"`,
        'Understand why this rule exists and what it prevents',
        'Apply the suggested fix or refactor code to comply',
        'If rule is inappropriate, consider configuring an exception',
      ],
      acceptance: [
        `No ${finding.ruleId} violations in affected files`,
        'Tests pass',
      ],
    },
    tsc: {
      goal: `Fix TypeScript error: ${finding.ruleId}`,
      steps: [
        'Read the error message carefully',
        'Check types of all involved expressions',
        'Fix type mismatches or add appropriate type annotations',
        'Avoid using `any` unless absolutely necessary',
      ],
      acceptance: [
        'TypeScript compilation succeeds',
        'Type safety is maintained',
      ],
    },
    prettier: {
      goal: 'Fix formatting issue',
      steps: [
        'Run prettier with --write flag to auto-fix',
        'Or manually adjust formatting to match project style',
      ],
      acceptance: [
        'Prettier reports no issues',
        'Code style is consistent',
      ],
    },
    jscpd: {
      goal: 'Reduce code duplication',
      steps: [
        'Identify the duplicated logic',
        'Extract to a shared function or module',
        'Replace duplicates with calls to shared code',
      ],
      acceptance: [
        'Duplication percentage reduced',
        'Tests pass',
        'Behavior unchanged',
      ],
    },
    'dependency-cruiser': {
      goal: 'Fix dependency architecture violation',
      steps: [
        'Review the dependency rule being violated',
        'Understand the architectural intent',
        'Refactor to respect module boundaries',
      ],
      acceptance: [
        'No dependency violations',
        'Architecture constraints respected',
      ],
    },
    knip: {
      goal: 'Clean up unused code',
      steps: [
        'Verify the code/export/dependency is truly unused',
        'Remove if unused, or add proper usage',
        'Update related tests and documentation',
      ],
      acceptance: [
        'No unused code warnings',
        'Codebase is cleaner',
      ],
    },
    semgrep: {
      goal: `Address security/quality issue: ${finding.ruleId}`,
      steps: [
        'Review the semgrep rule documentation',
        'Understand the security or quality concern',
        'Apply the recommended fix pattern',
        'Add tests to prevent regression',
      ],
      acceptance: [
        'Semgrep finding is resolved',
        'Security concern is addressed',
        'Tests verify the fix',
      ],
    },
    trunk: {
      goal: `Fix linter issue: ${finding.ruleId}`,
      steps: [
        'Review the specific linter rule',
        'Apply appropriate fix',
        'Verify fix does not introduce new issues',
      ],
      acceptance: [
        'Trunk check passes',
        'No regressions',
      ],
    },
    custom: {
      goal: 'Address code issue',
      steps: [
        'Review the finding details',
        'Apply appropriate fix',
        'Test the changes',
      ],
      acceptance: [
        'Issue is resolved',
        'Tests pass',
      ],
    },
  };

  return toolHints[finding.tool] || toolHints.custom;
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Build summary statistics for findings.
 */
function buildSummary(
  findings: Finding[],
  severityThreshold: Severity | "info",
  confidenceThreshold: Confidence
): LlmJsonSummary {
  const bySeverity: Record<Severity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  const byTool: Record<string, number> = {};

  let highConfidence = 0;
  let actionable = 0;

  for (const finding of findings) {
    // Count by severity
    bySeverity[finding.severity]++;

    // Count by tool
    byTool[finding.tool] = (byTool[finding.tool] || 0) + 1;

    // Count high confidence
    if (finding.confidence === 'high') {
      highConfidence++;
    }

    // Count actionable (meets thresholds)
    if (meetsThresholds(finding.severity, finding.confidence, severityThreshold, confidenceThreshold)) {
      actionable++;
    }
  }

  return {
    totalFindings: findings.length,
    highConfidence,
    actionable,
    bySeverity,
    byTool,
  };
}

// ============================================================================
// Main Builder
// ============================================================================

/**
 * Build LLM JSON output from findings.
 */
export function buildLlmJson(findings: Finding[], context: RunContext): LlmJsonOutput {
  // Sort findings deterministically
  const sortedFindings = [...findings].sort(compareFindingsForSort);

  // Enrich with suggested fixes
  const enrichedFindings = sortedFindings.map((finding) => {
    // Remove rawOutput for LLM JSON (keep it lean)
    const { rawOutput, ...cleanFinding } = finding;

    return {
      ...cleanFinding,
      suggestedFix: finding.suggestedFix || getSuggestedFix(finding),
    };
  });

  const severityThreshold = context.config.issues?.severity_threshold || 'medium';
  const confidenceThreshold = context.config.issues?.confidence_threshold || 'high';

  return {
    version: 1,
    repo: context.repo,
    generatedAt: new Date().toISOString(),
    profile: {
      isMonorepo: context.profile.isMonorepo,
      languages: context.profile.languages,
      packageManager: context.profile.packageManager,
    },
    summary: buildSummary(findings, severityThreshold, confidenceThreshold),
    findings: enrichedFindings,
  };
}

/**
 * Write LLM JSON to file.
 */
export function writeLlmJsonFile(output: LlmJsonOutput, path: string): void {
  writeFileSync(path, JSON.stringify(output, null, 2), 'utf-8');
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const findingsPath = args[0] || 'findings.json';
  const outputPath = args[1] || 'results.llm.json';
  const contextPath = args[2] || 'context.json';

  // Load findings
  if (!existsSync(findingsPath)) {
    console.error(`Findings file not found: ${findingsPath}`);
    process.exit(1);
  }

  const findings: Finding[] = JSON.parse(readFileSync(findingsPath, 'utf-8'));

  // Load or build context
  let context: RunContext;
  if (existsSync(contextPath)) {
    context = JSON.parse(readFileSync(contextPath, 'utf-8'));
  } else {
    context = {
      repo: {
        owner: process.env.GITHUB_REPOSITORY_OWNER || 'unknown',
        name: process.env.GITHUB_REPOSITORY?.split('/')[1] || 'unknown',
        defaultBranch: 'main',
        commit: process.env.GITHUB_SHA || 'unknown',
      },
      profile: {
        languages: ['typescript'],
        packageManager: 'pnpm',
        isMonorepo: false,
        workspacePackages: [],
        hasTypeScript: true,
        hasEslint: false,
        hasPrettier: false,
        hasTrunk: false,
        hasDependencyCruiser: false,
        hasKnip: false,
        rootPath: process.cwd(),
      },
      config: { version: 1 },
      cadence: 'weekly',
      runNumber: parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10),
      workspacePath: process.cwd(),
      outputDir: '.',
    };
  }

  // Build and write LLM JSON
  const output = buildLlmJson(findings, context);
  writeLlmJsonFile(output, outputPath);

  console.log(`LLM JSON output written to: ${outputPath}`);
  console.log(`Total findings: ${output.summary.totalFindings}`);
  console.log(`Actionable: ${output.summary.actionable}`);
  console.log(`High confidence: ${output.summary.highConfidence}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
