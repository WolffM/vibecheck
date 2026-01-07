/**
 * Workflow Generator Module
 *
 * Generates GitHub Actions workflow YAML for vibeCheck installation.
 * This module is shared between the install page (browser) and tests (Node.js).
 */

export interface WorkflowOptions {
  cadence: 'daily' | 'weekly' | 'monthly';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  maxIssues: number;
  mergeStrategy: 'none' | 'same-file' | 'same-rule' | 'same-linter' | 'same-tool';
  disabledTools: string[];
}

export const DEFAULTS: WorkflowOptions = {
  cadence: 'weekly',
  severity: 'low',
  confidence: 'medium',
  maxIssues: 25,
  mergeStrategy: 'same-linter',
  disabledTools: [],
};

export const DEFAULT_TOOLS = [
  'trunk',
  'semgrep',
  'jscpd',
  'tsc',
  'dependency-cruiser',
  'knip',
  'ruff',
  'mypy',
  'bandit',
  'pmd',
  'spotbugs',
];

/**
 * Get cron expression for the given cadence
 */
export function getCronForCadence(cadence: WorkflowOptions['cadence']): string {
  switch (cadence) {
    case 'daily':
      return '0 3 * * *'; // Every day at 3am UTC
    case 'weekly':
      return '0 3 * * 1'; // Monday at 3am UTC
    case 'monthly':
      return '0 3 1 * *'; // 1st of month at 3am UTC
    default:
      return '0 3 * * 1';
  }
}

/**
 * Generate workflow YAML based on options
 */
export function generateWorkflow(options: WorkflowOptions): string {
  const { cadence, severity, confidence, mergeStrategy, disabledTools } = options;
  const cron = getCronForCadence(cadence);

  // Build the workflow
  let yaml = `# vibeCheck Analysis Workflow
#
# This workflow runs vibeCheck static analysis on your repository.
# For more info: https://github.com/WolffM/vibecheck

name: vibeCheck Analysis

on:
  # Run ${cadence} ${cadence === 'weekly' ? 'on Monday ' : cadence === 'monthly' ? 'on the 1st ' : ''}at 3am UTC
  schedule:
    - cron: "${cron}"

  # Allow manual trigger
  workflow_dispatch:
    inputs:
      cadence:
        description: "Analysis cadence"
        required: false
        default: "${cadence}"
        type: choice
        options:
          - daily
          - weekly
          - monthly

permissions:
  contents: read
  issues: write
  security-events: write

jobs:
  analyze:
    name: Static Analysis
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run vibeCheck
        uses: WolffM/vibecheck@main
        with:
          github_token: \${{ secrets.GITHUB_TOKEN }}
          cadence: \${{ github.event.inputs.cadence || '${cadence}' }}`;

  // Add custom options only if they differ from defaults
  if (severity !== 'info') {
    yaml += `\n          severity_threshold: "${severity}"`;
  }
  if (confidence !== 'low') {
    yaml += `\n          confidence_threshold: "${confidence}"`;
  }
  if (mergeStrategy !== 'same-linter') {
    yaml += `\n          merge_strategy: "${mergeStrategy}"`;
  }

  // If tools are disabled, add comments about it
  if (disabledTools.length > 0) {
    yaml += `\n          # Note: Some tools disabled. Create vibecheck.yml to customize:`;
    yaml += `\n          # tools:`;
    for (const tool of disabledTools) {
      const configKey = tool === 'dependency-cruiser' ? 'dependency_cruiser' : tool;
      yaml += `\n          #   ${configKey}: { enabled: false }`;
    }
  }

  yaml += '\n';
  return yaml;
}
