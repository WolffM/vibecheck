/**
 * Workflow Generator Module
 *
 * Generates GitHub Actions workflow YAML for vibeCheck installation.
 * This module is shared between the install page (browser) and tests (Node.js).
 */

export interface WorkflowOptions {
  cadence: 'manual' | 'daily' | 'weekly' | 'monthly';
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  mergeStrategy: 'none' | 'same-file' | 'same-rule';
  disabledTools: string[];
}

export const DEFAULTS: WorkflowOptions = {
  cadence: 'manual',
  severity: 'low',
  confidence: 'medium',
  mergeStrategy: 'same-rule',
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
 * Returns null for 'manual' (no schedule)
 */
export function getCronForCadence(cadence: WorkflowOptions['cadence']): string | null {
  switch (cadence) {
    case 'daily':
      return '0 3 * * *'; // Every day at 3am UTC
    case 'weekly':
      return '0 3 * * 1'; // Monday at 3am UTC
    case 'monthly':
      return '0 3 1 * *'; // 1st of month at 3am UTC
    case 'manual':
    default:
      return null; // Manual - no schedule
  }
}

/**
 * Generate workflow YAML based on options
 */
export function generateWorkflow(options: WorkflowOptions): string {
  const { cadence, severity, confidence, mergeStrategy, disabledTools } = options;
  const cron = getCronForCadence(cadence);

  // Build the on: section based on cadence
  let onSection: string;
  if (cron) {
    const cadenceComment = cadence === 'weekly' ? 'on Monday ' : cadence === 'monthly' ? 'on the 1st ' : '';
    onSection = `on:
  # Run ${cadence} ${cadenceComment}at 3am UTC
  schedule:
    - cron: "${cron}"

  # Allow manual trigger
  workflow_dispatch:`;
  } else {
    onSection = `on:
  # Manual trigger only - run via Actions tab
  workflow_dispatch:`;
  }

  // Build the workflow
  let yaml = `# vibeCheck Workflow
#
# This workflow runs vibeCheck static analysis on your repository.
# For more info: https://github.com/WolffM/vibecheck

name: vibeCheck

${onSection}

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
          github_token: \${{ secrets.GITHUB_TOKEN }}`;

  // Add custom options only if they differ from defaults
  if (severity !== 'info') {
    yaml += `\n          severity_threshold: "${severity}"`;
  }
  if (confidence !== 'low') {
    yaml += `\n          confidence_threshold: "${confidence}"`;
  }
  if (mergeStrategy !== 'same-rule') {
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
