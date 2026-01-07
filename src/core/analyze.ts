/**
 * Main Analysis Orchestrator
 *
 * Coordinates the full analysis pipeline: tool execution, parsing,
 * SARIF/LLM JSON generation, and issue creation.
 *
 * Reference: vibeCheck_spec.md section 9
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectRepo } from "./repo-detect.js";
import { buildSarifLog, writeSarifFile } from "../output/build-sarif.js";
import {
  buildLlmJson,
  writeLlmJsonFile,
  type FindingStats,
} from "../output/build-llm-json.js";
import { processFindings } from "../github/sarif-to-issues.js";
import {
  deduplicateFindings,
  mergeIssues,
  type MergeStrategy,
} from "../utils/fingerprints.js";
import {
  loadVibeCopConfig,
  isValidSeverityThreshold,
  isValidConfidenceThreshold,
  parseSeverityThreshold,
  parseConfidenceThreshold,
} from "./config-loader.js";
import { getToolsToRun, executeTools } from "../tools/tool-registry.js";
import type {
  Cadence,
  Confidence,
  Finding,
  RepoProfile,
  RunContext,
  Severity,
  VibeCopConfig,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// ============================================================================
// Exported Types
// ============================================================================

export interface AnalyzeOptions {
  rootPath?: string;
  configPath?: string;
  cadence?: Cadence;
  outputDir?: string;
  skipIssues?: boolean;
  severityThreshold?: Severity | "info";
  confidenceThreshold?: Confidence;
  mergeStrategy?: MergeStrategy;
}

export interface AnalyzeResult {
  findings: Finding[];
  profile: RepoProfile;
  context: RunContext;
  stats: {
    totalFindings: number;
    uniqueFindings: number;
    mergedFindings: number;
    byTool: Record<string, number>;
  };
}

// ============================================================================
// Main Analysis Pipeline
// ============================================================================

/**
 * Run the full analysis pipeline.
 */
export async function analyze(
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const rootPath = options.rootPath || process.cwd();
  const configPath = options.configPath || "vibecheck.yml";
  const cadence = options.cadence || "weekly";
  const severityThreshold = options.severityThreshold || "info";
  const confidenceThreshold = options.confidenceThreshold || "low";
  const mergeStrategy = options.mergeStrategy || "same-rule";
  const outputDir = options.outputDir || join(rootPath, ".vibecheck-output");

  // Validate threshold values
  if (!isValidSeverityThreshold(severityThreshold)) {
    throw new Error(
      `Invalid severity threshold: "${severityThreshold}". Must be one of: info, low, medium, high, critical`,
    );
  }
  if (!isValidConfidenceThreshold(confidenceThreshold)) {
    throw new Error(
      `Invalid confidence threshold: "${confidenceThreshold}". Must be one of: low, medium, high`,
    );
  }

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log("=== vibeCheck ===");
  console.log(`Root: ${rootPath}`);
  console.log(`Cadence: ${cadence}`);
  console.log("");

  // Step 1: Detect repo profile
  console.log("Step 1: Detecting repository profile...");
  const profile = await detectRepo(rootPath);
  console.log(`  Languages: ${profile.languages.join(", ")}`);
  console.log(`  Package manager: ${profile.packageManager}`);
  console.log(`  Monorepo: ${profile.isMonorepo}`);
  console.log("");

  // Step 2: Load configuration
  console.log("Step 2: Loading configuration...");
  const config = loadVibeCopConfig(rootPath, configPath);
  console.log("");

  // Step 3: Run analysis tools using registry
  console.log("Step 3: Running analysis tools...");
  const toolsToRun = getToolsToRun(profile, cadence, config);
  const allFindings = executeTools(toolsToRun, rootPath, config);

  // Step 4: Deduplicate findings
  console.log("Step 4: Deduplicating findings...");
  const uniqueFindings = deduplicateFindings(allFindings);
  console.log(
    `  Total: ${allFindings.length} -> Unique: ${uniqueFindings.length}`,
  );

  // Step 4b: Merge findings based on strategy
  console.log(`Step 4b: Merging findings (strategy: ${mergeStrategy})...`);
  const mergedFindings = mergeIssues(uniqueFindings, mergeStrategy);
  console.log(
    `  Unique: ${uniqueFindings.length} -> Merged: ${mergedFindings.length}`,
  );
  console.log("");

  // Merge CLI threshold options into config (CLI takes precedence)
  const mergedConfig: VibeCopConfig = {
    ...config,
    issues: {
      // DEFAULT_CONFIG.issues is always defined (non-null assertion is safe)
      ...DEFAULT_CONFIG.issues!,
      ...config.issues,
      severity_threshold: severityThreshold,
      confidence_threshold: confidenceThreshold,
    },
  };

  // Build context
  const context: RunContext = {
    repo: {
      owner: process.env.GITHUB_REPOSITORY_OWNER || "unknown",
      name: process.env.GITHUB_REPOSITORY?.split("/")[1] || "unknown",
      defaultBranch: "main",
      commit: process.env.GITHUB_SHA || "unknown",
    },
    profile,
    config: mergedConfig,
    cadence,
    runNumber: parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10),
    workspacePath: rootPath,
    outputDir,
  };

  // Step 5: Generate outputs
  console.log("Step 5: Generating outputs...");

  // Write all findings (before merge) for debugging
  const allFindingsPath = join(outputDir, "findings-all.json");
  writeFileSync(allFindingsPath, JSON.stringify(uniqueFindings, null, 2));
  console.log(`  All findings: ${allFindingsPath}`);

  // Write merged findings for issue creation
  const findingsPath = join(outputDir, "findings.json");
  writeFileSync(findingsPath, JSON.stringify(mergedFindings, null, 2));
  console.log(`  Merged findings: ${findingsPath}`);

  // Write context
  const contextPath = join(outputDir, "context.json");
  writeFileSync(contextPath, JSON.stringify(context, null, 2));
  console.log(`  Context: ${contextPath}`);

  // Build SARIF (use all unique findings for code scanning)
  if (config.output?.sarif !== false) {
    const sarif = buildSarifLog(uniqueFindings, context);
    const sarifPath = join(outputDir, "results.sarif");
    writeSarifFile(sarif, sarifPath);
    console.log(`  SARIF: ${sarifPath}`);
  }

  // Build LLM JSON (use merged findings for agent consumption)
  if (config.output?.llm_json !== false) {
    const findingStats: FindingStats = {
      totalFindings: allFindings.length,
      uniqueFindings: uniqueFindings.length,
      mergedFindings: mergedFindings.length,
    };
    const llmJson = buildLlmJson(mergedFindings, context, findingStats);
    const llmJsonPath = join(outputDir, "results.llm.json");
    writeLlmJsonFile(llmJson, llmJsonPath);
    console.log(`  LLM JSON: ${llmJsonPath}`);
  }

  console.log("");

  // Step 6: Create/update issues (use merged findings)
  let issueStats = { created: 0, updated: 0, closed: 0 };
  if (
    !options.skipIssues &&
    config.issues?.enabled !== false &&
    process.env.GITHUB_TOKEN
  ) {
    console.log("Step 6: Processing GitHub issues...");
    const stats = await processFindings(mergedFindings, context);
    issueStats = {
      created: stats.created,
      updated: stats.updated,
      closed: stats.closed,
    };
    console.log(`  Created: ${issueStats.created}`);
    console.log(`  Updated: ${issueStats.updated}`);
    console.log(`  Closed: ${issueStats.closed}`);

    // Update LLM JSON with issue stats
    if (config.output?.llm_json !== false) {
      const llmJsonPath = join(outputDir, "results.llm.json");
      const llmJsonContent = JSON.parse(readFileSync(llmJsonPath, "utf-8"));
      llmJsonContent.summary.issuesCreated = issueStats.created;
      llmJsonContent.summary.issuesUpdated = issueStats.updated;
      llmJsonContent.summary.issuesClosed = issueStats.closed;
      writeFileSync(llmJsonPath, JSON.stringify(llmJsonContent, null, 2));
      console.log(`  Updated LLM JSON with issue stats`);
    }
  } else {
    console.log("Step 6: Skipping GitHub issues (disabled or no token)");
  }

  console.log("");
  console.log("=== Analysis Complete ===");

  // Calculate stats
  const byTool: Record<string, number> = {};
  for (const finding of uniqueFindings) {
    byTool[finding.tool] = (byTool[finding.tool] || 0) + 1;
  }

  return {
    findings: mergedFindings,
    profile,
    context,
    stats: {
      totalFindings: allFindings.length,
      uniqueFindings: uniqueFindings.length,
      mergedFindings: mergedFindings.length,
      byTool,
    },
  };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  const options: AnalyzeOptions = {
    rootPath: process.cwd(),
    cadence: "weekly",
  };

  // Parse simple CLI args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" && args[i + 1]) {
      options.rootPath = args[++i];
    } else if (arg === "--cadence" && args[i + 1]) {
      options.cadence = args[++i] as Cadence;
    } else if (arg === "--config" && args[i + 1]) {
      options.configPath = args[++i];
    } else if (arg === "--output" && args[i + 1]) {
      options.outputDir = args[++i];
    } else if (arg === "--skip-issues") {
      options.skipIssues = true;
    } else if (arg === "--severity" && args[i + 1]) {
      try {
        options.severityThreshold = parseSeverityThreshold(args[++i]);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }
    } else if (arg === "--confidence" && args[i + 1]) {
      try {
        options.confidenceThreshold = parseConfidenceThreshold(args[++i]);
      } catch (e) {
        console.error(`Error: ${(e as Error).message}`);
        process.exit(1);
      }
    } else if (arg === "--merge" && args[i + 1]) {
      options.mergeStrategy = args[++i] as MergeStrategy;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: analyze [options]

Options:
  --root <path>        Root directory to analyze (default: cwd)
  --cadence <cadence>  Analysis cadence: daily, weekly, monthly (default: weekly)
  --config <path>      Path to vibecheck config file (default: vibecheck.yml)
  --output <path>      Output directory (default: .vibecheck-output)
  --skip-issues        Skip GitHub issue creation
  --severity <level>   Severity threshold: info, low, medium, high, critical
  --confidence <level> Confidence threshold: low, medium, high
  --merge <strategy>   Merge strategy: same-rule, same-file, none
  --help, -h           Show this help message
`);
      process.exit(0);
    }
  }

  try {
    const result = await analyze(options);
    console.log(`\nSummary:`);
    console.log(`  Total findings: ${result.stats.totalFindings}`);
    console.log(`  Unique findings: ${result.stats.uniqueFindings}`);
    console.log(`  Merged findings: ${result.stats.mergedFindings}`);
    console.log(`  By tool:`);
    for (const [tool, count] of Object.entries(result.stats.byTool)) {
      console.log(`    ${tool}: ${count}`);
    }

    // Exit with error code if findings exceed threshold on scheduled runs
    if (process.env.GITHUB_EVENT_NAME === "schedule") {
      const criticalFindings = result.findings.filter(
        (f) => f.severity === "critical" || f.severity === "high",
      );
      if (criticalFindings.length > 0) {
        console.warn(
          `\nWarning: ${criticalFindings.length} critical/high severity findings`,
        );
        // Don't exit with error for scheduled runs - just report
      }
    }
  } catch (error) {
    console.error("Analysis failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
