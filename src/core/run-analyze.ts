#!/usr/bin/env npx tsx
/**
 * CLI runner for analyze.ts
 * Use: npx tsx src/core/run-analyze.ts [options]
 */

import { analyze, type AnalyzeOptions } from './analyze.js';
import type { Cadence } from './types.js';

const args = process.argv.slice(2);

const options: AnalyzeOptions = {
  rootPath: process.cwd(),
  cadence: 'weekly',
};

// Parse CLI args
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--root' && args[i + 1]) {
    options.rootPath = args[++i];
  } else if (arg === '--cadence' && args[i + 1]) {
    options.cadence = args[++i] as Cadence;
  } else if (arg === '--config' && args[i + 1]) {
    options.configPath = args[++i];
  } else if (arg === '--output' && args[i + 1]) {
    options.outputDir = args[++i];
  } else if (arg === '--skip-issues') {
    options.skipIssues = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
vibeCheck Runner

Usage: npx tsx src/core/run-analyze.ts [options]

Options:
  --root <path>      Root path to analyze (default: cwd)
  --cadence <type>   daily | weekly | monthly (default: weekly)
  --config <path>    Path to vibecheck.yml (default: vibecheck.yml)
  --output <path>    Output directory (default: .vibecheck-output)
  --skip-issues      Skip GitHub issue creation
  --help, -h         Show this help
`);
    process.exit(0);
  }
}

console.log('Starting vibeCheck...');
console.log('Options:', JSON.stringify(options, null, 2));
console.log('');

analyze(options)
  .then((result) => {
    console.log('\n=== Analysis Complete ===');
    console.log(`Total findings: ${result.stats.totalFindings}`);
    console.log(`Unique findings: ${result.stats.uniqueFindings}`);
    console.log('By tool:', result.stats.byTool);

    const highSeverity = result.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'critical'
    );
    if (highSeverity.length > 0) {
      console.log(`\n⚠️  Found ${highSeverity.length} high/critical severity findings`);
    }
  })
  .catch((error) => {
    console.error('Analysis failed:', error);
    process.exit(1);
  });
