/**
 * Tool Registry
 *
 * Declarative configuration for all analysis tools.
 * Provides a data-driven approach to tool execution.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Cadence,
  Finding,
  RepoProfile,
  ToolName,
  VibeCopConfig,
} from "../core/types.js";
import { shouldRunTool } from "../core/config-loader.js";
import { shouldExcludePath } from "./tool-utils.js";
import {
  runTrunk,
  runTsc,
  runJscpd,
  runDependencyCruiser,
  runKnip,
  runSemgrep,
  runRuff,
  runMypy,
  runBandit,
  runPmd,
  runSpotBugs,
} from "./tool-runners.js";

// ============================================================================
// Types
// ============================================================================

export interface ToolDefinition {
  /** Tool identifier */
  name: ToolName;
  /** Display name for logging */
  displayName: string;
  /** Default cadence if not specified in config */
  defaultCadence: Cadence;
  /** Returns true if tool should run for this repo profile */
  detector: (profile: RepoProfile) => boolean;
  /** The runner function */
  run: (rootPath: string, configPath?: string) => Finding[];
  /** Config key path in VibeCopConfig.tools */
  configKey: string;
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Map of tool names to their Trunk linter equivalents.
 * Used to check if Trunk has these linters enabled before skipping.
 */
const TOOL_TO_TRUNK_LINTER: Record<string, string> = {
  ruff: "ruff",
  bandit: "bandit",
  mypy: "mypy",
};

/**
 * Registry of all available analysis tools.
 * Order matters - tools run in this order.
 */
const TOOL_REGISTRY: ToolDefinition[] = [
  // Daily tools - run frequently
  {
    name: "trunk",
    displayName: "Trunk (ESLint, Prettier, etc.)",
    defaultCadence: "daily",
    detector: () => true, // Always try trunk
    run: (rootPath) => runTrunk(rootPath),
    configKey: "trunk",
  },
  {
    name: "tsc",
    displayName: "TypeScript",
    defaultCadence: "daily",
    detector: (p) => p.hasTypeScript,
    run: (rootPath) => runTsc(rootPath),
    configKey: "tsc",
  },

  // Weekly tools - more expensive analysis
  {
    name: "jscpd",
    displayName: "Copy-Paste Detector",
    defaultCadence: "weekly",
    detector: () => true, // Always run
    run: (rootPath, config) => {
      const minTokens = config ? parseInt(config, 10) : 70;
      return runJscpd(rootPath, minTokens);
    },
    configKey: "jscpd",
  },
  {
    name: "dependency-cruiser",
    displayName: "Dependency Cruiser",
    defaultCadence: "weekly",
    detector: (p) => p.hasTypeScript || p.languages.includes("javascript"),
    run: (rootPath, config) => runDependencyCruiser(rootPath, config),
    configKey: "dependency_cruiser",
  },
  {
    name: "knip",
    displayName: "Knip (Dead Code)",
    defaultCadence: "weekly",
    detector: (p) => p.hasTypeScript || p.languages.includes("javascript"),
    run: (rootPath, config) => runKnip(rootPath, config),
    configKey: "knip",
  },
  {
    name: "semgrep",
    displayName: "Semgrep (Security)",
    defaultCadence: "weekly",
    detector: () => true, // Try on all repos
    run: (rootPath, config) => runSemgrep(rootPath, config),
    configKey: "semgrep",
  },

  // Python tools
  {
    name: "ruff",
    displayName: "Ruff (Python Linter)",
    defaultCadence: "daily",
    detector: (p) => p.languages.includes("python"),
    run: (rootPath, config) => runRuff(rootPath, config),
    configKey: "ruff",
  },
  {
    name: "mypy",
    displayName: "Mypy (Python Types)",
    defaultCadence: "weekly",
    detector: (p) => p.languages.includes("python"),
    run: (rootPath, config) => runMypy(rootPath, config),
    configKey: "mypy",
  },
  {
    name: "bandit",
    displayName: "Bandit (Python Security)",
    defaultCadence: "weekly",
    detector: (p) => p.languages.includes("python"),
    run: (rootPath, config) => runBandit(rootPath, config),
    configKey: "bandit",
  },

  // Java tools
  {
    name: "pmd",
    displayName: "PMD (Java)",
    defaultCadence: "weekly",
    detector: (p) => p.languages.includes("java"),
    run: (rootPath, config) => runPmd(rootPath, config),
    configKey: "pmd",
  },
  {
    name: "spotbugs",
    displayName: "SpotBugs (Java)",
    defaultCadence: "weekly",
    detector: (p) => p.languages.includes("java"),
    run: (rootPath, config) => runSpotBugs(rootPath, config),
    configKey: "spotbugs",
  },
];

// ============================================================================
// Registry Functions
// ============================================================================

/**
 * Get the configuration for a tool from VibeCopConfig.
 */
function getToolConfig(
  config: VibeCopConfig,
  toolKey: string,
):
  | {
      enabled?: boolean | "auto" | Cadence;
      config_path?: string;
      min_tokens?: number;
    }
  | undefined {
  const tools = config.tools as Record<string, unknown> | undefined;
  if (!tools) return undefined;
  return tools[toolKey] as
    | {
        enabled?: boolean | "auto" | Cadence;
        config_path?: string;
        min_tokens?: number;
      }
    | undefined;
}

/**
 * Read the enabled linters from trunk.yaml if it exists.
 * Returns a Set of linter names that Trunk has enabled.
 */
function getTrunkEnabledLinters(rootPath: string): Set<string> {
  const trunkYaml = join(rootPath, ".trunk", "trunk.yaml");
  if (!existsSync(trunkYaml)) {
    return new Set();
  }

  try {
    const content = readFileSync(trunkYaml, "utf-8");
    // Simple YAML parsing for the enabled linters list
    // Looks for patterns like "    - ruff@1.2.3" or "    - ruff"
    const enabledLinters = new Set<string>();
    const lintSection = content.match(/lint:\s*\n\s*enabled:\s*\n((?:\s+-[^\n]+\n)+)/);
    if (lintSection) {
      const lines = lintSection[1].split("\n");
      for (const line of lines) {
        const match = line.match(/^\s+-\s+([a-z-]+)/i);
        if (match) {
          enabledLinters.add(match[1].toLowerCase());
        }
      }
    }
    return enabledLinters;
  } catch {
    return new Set();
  }
}

/**
 * Get tools that should run for a given profile and cadence.
 * Skips standalone tools when Trunk is enabled AND has those linters configured.
 */
export function getToolsToRun(
  profile: RepoProfile,
  cadence: Cadence,
  config: VibeCopConfig,
): ToolDefinition[] {
  // First, determine if Trunk is enabled
  const trunkConfig = getToolConfig(config, "trunk");
  const trunkEnabled = trunkConfig?.enabled !== false; // Trunk enabled by default

  // Get the actual linters that Trunk has enabled in trunk.yaml
  const trunkLinters = trunkEnabled ? getTrunkEnabledLinters(profile.rootPath) : new Set<string>();

  return TOOL_REGISTRY.filter((tool) => {
    const toolConfig = getToolConfig(config, tool.configKey);
    const enabled = toolConfig?.enabled ?? tool.defaultCadence;

    // Skip tools that Trunk already covers (unless explicitly enabled in vibecheck config)
    // Only skip if Trunk actually has the equivalent linter enabled in trunk.yaml
    const trunkLinter = TOOL_TO_TRUNK_LINTER[tool.name];
    if (trunkEnabled && trunkLinter && trunkLinters.has(trunkLinter) && toolConfig?.enabled === undefined) {
      console.log(`  Skipping ${tool.name} (covered by Trunk)`);
      return false;
    }

    return shouldRunTool(enabled, profile, cadence, () =>
      tool.detector(profile),
    );
  });
}

/**
 * Check if running in GitHub Actions environment.
 */
function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

/**
 * Log a group start (collapsible section in GitHub Actions).
 */
function startGroup(name: string): void {
  if (isGitHubActions()) {
    console.log(`::group::${name}`);
  } else {
    console.log(`\n▶ ${name}`);
  }
}

/**
 * Log a group end.
 */
function endGroup(): void {
  if (isGitHubActions()) {
    console.log("::endgroup::");
  }
}

/**
 * Execute all applicable tools and collect findings.
 */
export function executeTools(
  tools: ToolDefinition[],
  rootPath: string,
  config: VibeCopConfig,
): Finding[] {
  const allFindings: Finding[] = [];
  const toolResults: { name: string; count: number; status: "success" | "failed" }[] = [];

  console.log("\n=== Running Analysis Tools ===\n");

  for (const tool of tools) {
    const toolConfig = getToolConfig(config, tool.configKey);
    const configPath =
      toolConfig?.config_path ||
      (tool.configKey === "jscpd"
        ? String(toolConfig?.min_tokens || 70)
        : undefined);

    startGroup(`🔍 ${tool.displayName}`);
    
    try {
      const findings = tool.run(rootPath, configPath);
      allFindings.push(...findings);
      toolResults.push({ name: tool.displayName, count: findings.length, status: "success" });
      console.log(`✅ Found ${findings.length} findings`);
    } catch (error) {
      toolResults.push({ name: tool.displayName, count: 0, status: "failed" });
      console.warn(`❌ Failed: ${error}`);
    }
    
    endGroup();
  }

  // Print summary table
  console.log("\n=== Tool Summary ===\n");
  for (const result of toolResults) {
    const icon = result.status === "success" ? "✓" : "✗";
    const countStr = result.status === "success" ? `${result.count} findings` : "failed";
    console.log(`  ${icon} ${result.name}: ${countStr}`);
  }

  // Filter out findings from excluded directories (e.g., .trunk, node_modules)
  const filteredFindings = allFindings.filter((finding) => {
    // Check if ANY location is in an excluded path
    const allLocationsExcluded = finding.locations.every((loc) =>
      shouldExcludePath(loc.path)
    );
    
    if (allLocationsExcluded && finding.locations.length > 0) {
      return false; // Exclude this finding
    }
    
    // For findings with mixed locations, filter out excluded locations
    if (finding.locations.some((loc) => shouldExcludePath(loc.path))) {
      finding.locations = finding.locations.filter(
        (loc) => !shouldExcludePath(loc.path)
      );
      // If no locations remain, exclude the finding
      if (finding.locations.length === 0) {
        return false;
      }
    }
    
    return true;
  });

  const excludedCount = allFindings.length - filteredFindings.length;
  if (excludedCount > 0) {
    console.log(`\n  (Filtered ${excludedCount} findings from excluded directories)`);
  }

  console.log(`\nTotal raw findings: ${filteredFindings.length}\n`);
  return filteredFindings;
}
