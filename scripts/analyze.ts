/**
 * Main Analysis Orchestrator
 *
 * Coordinates the full analysis pipeline: tool execution, parsing,
 * SARIF/LLM JSON generation, and issue creation.
 *
 * Reference: vibeCop_spec.md section 9
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { detectRepo } from "./repo-detect.js";
import {
  parseTscTextOutput,
  parseTscOutput,
  parseJscpdOutput,
  parseTrunkOutput,
  parseDepcruiseOutput,
  parseKnipOutput,
  parseSemgrepOutput,
} from "./parsers.js";
import { buildSarifLog, writeSarifFile } from "./build-sarif.js";
import { buildLlmJson, writeLlmJsonFile } from "./build-llm-json.js";
import { processFindings } from "./sarif-to-issues.js";
import {
  deduplicateFindings,
  mergeIssues,
  type MergeStrategy,
} from "./fingerprints.js";
import type {
  Cadence,
  Confidence,
  Finding,
  RepoProfile,
  RunContext,
  Severity,
  VibeCopConfig,
} from "./types.js";

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load vibecop.yml config from repo root.
 */
function loadVibeCopConfig(
  rootPath: string,
  configPath: string = "vibecop",
): VibeCopConfig {
  // Try JSON first, then YAML
  const baseName = configPath.replace(/\.(json|yml|yaml)$/, "");
  const jsonPath = join(rootPath, `${baseName}.json`);
  const ymlPath = join(rootPath, `${baseName}.yml`);

  // Try JSON config first
  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, "utf-8");
      console.log(`Loaded config from ${jsonPath}`);
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to parse JSON config: ${error}`);
    }
  }

  // Try YAML config
  if (existsSync(ymlPath)) {
    try {
      const content = readFileSync(ymlPath, "utf-8");
      console.log(`Config file found at ${ymlPath}`);
      return parseSimpleYaml(content);
    } catch (error) {
      console.warn(`Failed to parse YAML config: ${error}`);
    }
  }

  console.log(
    `No config file found at ${jsonPath} or ${ymlPath}, using defaults`,
  );
  return { version: 1 };
}

/**
 * Very basic YAML parser for vibecop.yml structure.
 * For production, use the 'yaml' npm package.
 */
function parseSimpleYaml(content: string): VibeCopConfig {
  // This is a simplified parser - for production use a real YAML library
  const config: VibeCopConfig = { version: 1 };

  try {
    // Remove comments and parse as basic key-value
    // For MVP, just return defaults - config parsing would need yaml package
    const _lines = content.split("\n").filter((l) => !l.trim().startsWith("#"));
    console.log(
      "Note: Full YAML parsing requires yaml package. Using defaults.",
    );
    void _lines; // TODO: implement proper YAML parsing
  } catch {
    // Fallback to defaults
  }

  return config;
}

/**
 * Determine if a tool should run based on config and cadence.
 */
function shouldRunTool(
  enabled: boolean | "auto" | Cadence | undefined,
  _profile: RepoProfile,
  currentCadence: Cadence,
  toolDetector: () => boolean,
): boolean {
  if (enabled === false) return false;
  if (enabled === true) return true;

  // Cadence-based enablement
  if (enabled === "daily" || enabled === "weekly" || enabled === "monthly") {
    const cadenceOrder = { daily: 0, weekly: 1, monthly: 2 };
    return cadenceOrder[currentCadence] >= cadenceOrder[enabled];
  }

  // Auto-detect
  if (enabled === "auto" || enabled === undefined) {
    return toolDetector();
  }

  return false;
}

// ============================================================================
// Tool Runners
// ============================================================================

/**
 * Run Trunk check and capture output.
 */
function runTrunk(rootPath: string, args: string[] = ["check"]): Finding[] {
  console.log("Running Trunk...");

  try {
    // Check if trunk is available (via npm or global install)
    const versionCheck = spawnSync("pnpm", ["exec", "trunk", "--version"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      // Try global trunk
      const globalCheck = spawnSync("trunk", ["--version"], {
        encoding: "utf-8",
        shell: true,
      });
      if (globalCheck.error || globalCheck.status !== 0) {
        console.log("  Trunk not installed, skipping");
        return [];
      }
    }

    // Use pnpm exec if @trunkio/launcher is installed, otherwise global trunk
    const trunkCmd =
      versionCheck.status === 0 ? ["pnpm", "exec", "trunk"] : ["trunk"];
    const trunkArgs = [...args, "--output=json", "--no-progress"];

    const trunkResult = spawnSync(
      trunkCmd[0],
      [...trunkCmd.slice(1), ...trunkArgs],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 50 * 1024 * 1024, // 50MB
      },
    );

    // Trunk outputs JSON but may include ANSI codes, extract JSON portion
    const output = trunkResult.stdout || "";
    const jsonMatch = output.match(/\{[\s\S]*\}(?=\s*$)/);
    if (jsonMatch) {
      try {
        const trunkOutput = JSON.parse(jsonMatch[0]);
        return parseTrunkOutput(trunkOutput);
      } catch {
        console.warn("Failed to parse Trunk JSON output");
      }
    }

    if (trunkResult.stderr) {
      console.log("Trunk stderr:", trunkResult.stderr);
    }
  } catch (error) {
    console.warn("Trunk not available or failed:", error);
  }

  return [];
}

/**
 * Run TypeScript type checking.
 */
function runTsc(rootPath: string): Finding[] {
  console.log("Running TypeScript check...");

  try {
    const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
    });

    // tsc exits with error code when there are type errors
    const output = result.stdout + result.stderr;
    const diagnostics = parseTscTextOutput(output);
    return parseTscOutput(diagnostics);
  } catch (error) {
    console.warn("TypeScript check failed:", error);
  }

  return [];
}

// NOTE: ESLint is handled by Trunk, so runEslint has been removed
// to avoid duplicate findings. Trunk runs ESLint internally.

/**
 * Run jscpd (copy-paste detector).
 */
function runJscpd(rootPath: string, minTokens: number = 70): Finding[] {
  console.log(`Running jscpd (min-tokens: ${minTokens})...`);

  try {
    const outputDir = join(rootPath, ".vibecop-output");
    const outputPath = join(outputDir, "jscpd-report.json");

    // Run jscpd - we don't need the result, just the output file
    spawnSync(
      "npx",
      [
        "jscpd",
        ".",
        `--min-tokens=${minTokens}`,
        "--min-lines=5",
        "--reporters=json",
        `--output=${outputDir}`,
        '--ignore="**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/.vibecop-output/**"',
      ],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
      },
    );

    if (existsSync(outputPath)) {
      const output = JSON.parse(readFileSync(outputPath, "utf-8"));
      return parseJscpdOutput(output);
    }
  } catch (error) {
    console.warn("jscpd failed:", error);
  }

  return [];
}

/**
 * Run dependency-cruiser for circular dependencies and architecture violations.
 */
function runDependencyCruiser(
  rootPath: string,
  configPath?: string,
): Finding[] {
  console.log("Running dependency-cruiser...");

  const config = configPath || ".dependency-cruiser.cjs";
  const fullConfigPath = join(rootPath, config);

  if (!existsSync(fullConfigPath)) {
    console.log(`  No config found at ${config}, skipping`);
    return [];
  }

  try {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "dependency-cruiser",
        "scripts",
        "test-fixtures",
        "--config",
        config,
        "--output-type",
        "json",
      ],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    // dependency-cruiser outputs JSON to stdout even with violations
    const output = result.stdout;
    if (output && output.trim().startsWith("{")) {
      try {
        const depcruiseOutput = JSON.parse(output);
        return parseDepcruiseOutput(depcruiseOutput);
      } catch (e) {
        console.warn("Failed to parse dependency-cruiser JSON output:", e);
      }
    }
  } catch (error) {
    console.warn("dependency-cruiser failed:", error);
  }

  return [];
}

/**
 * Run knip for unused exports and dead code detection.
 */
function runKnip(rootPath: string, configPath?: string): Finding[] {
  console.log("Running knip...");

  const config = configPath || "knip.json";
  const fullConfigPath = join(rootPath, config);

  if (!existsSync(fullConfigPath)) {
    console.log(`  No config found at ${config}, skipping`);
    return [];
  }

  try {
    const result = spawnSync("pnpm", ["exec", "knip", "--reporter", "json"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    // knip outputs JSON to stdout, exits with code 1 if issues found
    const output = result.stdout;
    if (output && output.trim().startsWith("{")) {
      try {
        const knipOutput = JSON.parse(output);
        return parseKnipOutput(knipOutput);
      } catch (e) {
        console.warn("Failed to parse knip JSON output:", e);
      }
    }
  } catch (error) {
    console.warn("knip failed:", error);
  }

  return [];
}

/**
 * Run Semgrep for security vulnerability detection.
 * Uses p/security-audit ruleset by default (works better cross-platform than 'auto').
 */
function runSemgrep(rootPath: string, configPath?: string): Finding[] {
  console.log("Running semgrep...");

  try {
    // Check if semgrep is available
    const versionCheck = spawnSync("semgrep", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.error || versionCheck.status !== 0) {
      console.log("  Semgrep not installed, skipping");
      return [];
    }

    // Use security-audit ruleset by default (works better than 'auto' on Windows)
    const config = configPath || "p/security-audit";
    const args = ["scan", "--json", "--config", config, "."];

    const result = spawnSync("semgrep", args, {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    // Semgrep outputs JSON mixed with progress info, extract JSON portion
    const output = result.stdout || "";
    const jsonMatch = output.match(/\{[\s\S]*"version"[\s\S]*\}(?=\s*$)/);
    if (jsonMatch) {
      try {
        const semgrepOutput = JSON.parse(jsonMatch[0]);
        return parseSemgrepOutput(semgrepOutput);
      } catch (e) {
        console.warn("Failed to parse semgrep JSON output:", e);
      }
    }

    // Handle known Windows encoding issues gracefully
    if (result.stderr && result.stderr.includes("charmap")) {
      console.log(
        "  Semgrep has encoding issues, try: semgrep scan --config p/security-audit .",
      );
      return [];
    }
  } catch (error) {
    console.warn("semgrep failed:", error);
  }

  return [];
}

// ============================================================================
// Main Analysis Pipeline
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

/**
 * Run the full analysis pipeline.
 */
export async function analyze(
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const rootPath = options.rootPath || process.cwd();
  const configPath = options.configPath || "vibecop.yml";
  const cadence = options.cadence || "weekly";
  const severityThreshold = options.severityThreshold || "info";
  const confidenceThreshold = options.confidenceThreshold || "low";
  const mergeStrategy = options.mergeStrategy || "same-rule";
  const outputDir = options.outputDir || join(rootPath, ".vibecop-output");

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log("=== vibeCop Analysis ===");
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

  // Step 3: Run analysis tools
  console.log("Step 3: Running analysis tools...");
  const allFindings: Finding[] = [];

  // Trunk (if available)
  if (config.trunk?.enabled !== false) {
    const trunkFindings = runTrunk(
      rootPath,
      (config.trunk?.arguments || "check").split(" "),
    );
    allFindings.push(...trunkFindings);
    console.log(`  Trunk: ${trunkFindings.length} findings`);
  }

  // TypeScript
  if (
    shouldRunTool(
      config.tools?.tsc?.enabled,
      profile,
      cadence,
      () => profile.hasTypeScript,
    )
  ) {
    const tscFindings = runTsc(rootPath);
    allFindings.push(...tscFindings);
    console.log(`  TypeScript: ${tscFindings.length} findings`);
  }

  // NOTE: ESLint is handled by Trunk, so we don't run it separately
  // to avoid duplicate findings. If you need standalone ESLint,
  // configure it in your vibecop.yml with tools.eslint.enabled: true

  // jscpd (weekly/monthly)
  if (
    shouldRunTool(
      config.tools?.jscpd?.enabled || "weekly",
      profile,
      cadence,
      () => true,
    )
  ) {
    const jscpdFindings = runJscpd(rootPath, config.tools?.jscpd?.min_tokens);
    allFindings.push(...jscpdFindings);
    console.log(`  jscpd: ${jscpdFindings.length} findings`);
  }

  // dependency-cruiser (weekly/monthly)
  if (
    shouldRunTool(
      config.tools?.dependency_cruiser?.enabled || "weekly",
      profile,
      cadence,
      () => profile.hasDependencyCruiser,
    )
  ) {
    const depcruiseFindings = runDependencyCruiser(
      rootPath,
      config.tools?.dependency_cruiser?.config_path,
    );
    allFindings.push(...depcruiseFindings);
    console.log(`  dependency-cruiser: ${depcruiseFindings.length} findings`);
  }

  // knip (monthly)
  if (
    shouldRunTool(
      config.tools?.knip?.enabled || "monthly",
      profile,
      cadence,
      () => profile.hasKnip,
    )
  ) {
    const knipFindings = runKnip(rootPath, config.tools?.knip?.config_path);
    allFindings.push(...knipFindings);
    console.log(`  knip: ${knipFindings.length} findings`);
  }

  // semgrep (weekly/monthly for security scanning)
  if (
    shouldRunTool(
      config.tools?.semgrep?.enabled || "weekly",
      profile,
      cadence,
      () => true,
    )
  ) {
    const semgrepFindings = runSemgrep(rootPath, config.tools?.semgrep?.config);
    allFindings.push(...semgrepFindings);
    console.log(`  semgrep: ${semgrepFindings.length} findings`);
  }

  console.log("");

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
  const mergedConfig = {
    ...config,
    issues: {
      ...config.issues,
      severity_threshold: severityThreshold,
      confidence_threshold: confidenceThreshold,
      merge_strategy: mergeStrategy,
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
    const llmJson = buildLlmJson(mergedFindings, context);
    const llmJsonPath = join(outputDir, "results.llm.json");
    writeLlmJsonFile(llmJson, llmJsonPath);
    console.log(`  LLM JSON: ${llmJsonPath}`);
  }

  console.log("");

  // Step 6: Create/update issues (use merged findings)
  if (
    !options.skipIssues &&
    config.issues?.enabled !== false &&
    process.env.GITHUB_TOKEN
  ) {
    console.log("Step 6: Processing GitHub issues...");
    const issueStats = await processFindings(mergedFindings, context);
    console.log(`  Created: ${issueStats.created}`);
    console.log(`  Updated: ${issueStats.updated}`);
    console.log(`  Closed: ${issueStats.closed}`);
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
// CLI Validation Helpers
// ============================================================================

/**
 * Validate and parse severity threshold from CLI input.
 * Throws an error if the value is invalid.
 */
function parseSeverityThreshold(value: string): Severity | "info" {
  const validValues: Array<Severity | "info"> = [
    "info",
    "low",
    "medium",
    "high",
    "critical",
  ];
  if (validValues.includes(value as Severity | "info")) {
    return value as Severity | "info";
  }
  throw new Error(
    `Invalid severity threshold: '${value}'. Must be one of: ${validValues.join(", ")}`,
  );
}

/**
 * Validate and parse confidence threshold from CLI input.
 * Throws an error if the value is invalid.
 */
function parseConfidenceThreshold(value: string): Confidence {
  const validValues: Confidence[] = ["low", "medium", "high"];
  if (validValues.includes(value as Confidence)) {
    return value as Confidence;
  }
  throw new Error(
    `Invalid confidence threshold: '${value}'. Must be one of: ${validValues.join(", ")}`,
  );
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
    } else if (arg === "--severity-threshold" && args[i + 1]) {
      options.severityThreshold = parseSeverityThreshold(args[++i]);
    } else if (arg === "--confidence-threshold" && args[i + 1]) {
      options.confidenceThreshold = parseConfidenceThreshold(args[++i]);
    } else if (arg === "--merge-strategy" && args[i + 1]) {
      options.mergeStrategy = args[++i] as MergeStrategy;
    }
  }

  try {
    const result = await analyze(options);

    // Exit with error code if there are high-severity findings
    const highSeverity = result.findings.filter(
      (f) => f.severity === "high" || f.severity === "critical",
    );
    if (highSeverity.length > 0) {
      console.log(
        `\n⚠️  Found ${highSeverity.length} high/critical severity findings`,
      );
      // Don't exit with error for scheduled runs - just report
    }
  } catch (error) {
    console.error("Analysis failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
