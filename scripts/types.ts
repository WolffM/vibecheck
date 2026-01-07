/**
 * vibeCheck Core Types
 *
 * Central type definitions for the static analysis pipeline.
 * Reference: vibeCheck_spec.md sections 5, 6, 7
 */

// ============================================================================
// Configuration Types (vibecheck.yml schema)
// ============================================================================

export type Cadence = "daily" | "weekly" | "monthly";
type ToolEnablement = "auto" | boolean | Cadence;
export type Severity = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type AutofixLevel = "none" | "safe" | "requires_review";
export type Layer = "code" | "architecture" | "system" | "security";

interface ToolConfig {
  enabled: ToolEnablement;
  [key: string]: unknown;
}

interface TscConfig extends ToolConfig {
  // inherits enabled
}

interface EslintConfig extends ToolConfig {
  config_path?: string;
}

interface PrettierConfig extends ToolConfig {
  config_path?: string;
}

interface JscpdConfig extends ToolConfig {
  min_tokens?: number;
  threshold?: number; // percent duplication threshold
}

interface DependencyCruiserConfig extends ToolConfig {
  config_path?: string;
}

interface KnipConfig extends ToolConfig {
  config_path?: string;
}

interface SemgrepConfig extends ToolConfig {
  config?: string;
  rules_path?: string;
}

// Python tool configs
interface RuffConfig extends ToolConfig {
  config_path?: string;
  select?: string[]; // Rule selection
  ignore?: string[]; // Rules to ignore
}

interface MypyConfig extends ToolConfig {
  config_path?: string;
  strict?: boolean;
}

interface BanditConfig extends ToolConfig {
  config_path?: string;
  confidence?: "low" | "medium" | "high";
  severity?: "low" | "medium" | "high";
}

// Java tool configs
interface PmdConfig extends ToolConfig {
  config_path?: string;
  rulesets?: string[]; // PMD rulesets to use
}

interface SpotBugsConfig extends ToolConfig {
  config_path?: string;
  effort?: "min" | "default" | "max";
  threshold?: "low" | "medium" | "high";
}

export interface ToolsConfig {
  tsc?: TscConfig;
  eslint?: EslintConfig;
  prettier?: PrettierConfig;
  jscpd?: JscpdConfig;
  dependency_cruiser?: DependencyCruiserConfig;
  knip?: KnipConfig;
  semgrep?: SemgrepConfig;
  // Python tools
  ruff?: RuffConfig;
  mypy?: MypyConfig;
  bandit?: BanditConfig;
  // Java tools
  pmd?: PmdConfig;
  spotbugs?: SpotBugsConfig;
}

export interface TrunkConfig {
  enabled: boolean;
  arguments: string;
  extra_args?: string[];
}

export interface ScheduleConfig {
  cadence: Cadence;
  deep_scan?: boolean;
}

export interface IssuesConfig {
  enabled: boolean;
  label: string;
  max_new_per_run: number;
  severity_threshold: Severity | "info";
  confidence_threshold: Confidence;
  close_resolved: boolean;
  assignees?: string[];
  project?: string | null;
}

export interface OutputConfig {
  sarif: boolean;
  llm_json: boolean;
  artifact_retention_days: number;
}

export interface LlmConfig {
  agent_hint: string;
  pr_branch_prefix: string;
}

export interface VibeCopConfig {
  version: number;
  schedule?: ScheduleConfig;
  trunk?: TrunkConfig;
  tools?: ToolsConfig;
  issues?: IssuesConfig;
  output?: OutputConfig;
  llm?: LlmConfig;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: VibeCopConfig = {
  version: 1,
  issues: {
    enabled: true,
    label: "vibeCheck",
    max_new_per_run: 25,
    severity_threshold: "info",
    confidence_threshold: "low",
    close_resolved: true, // Auto-close issues when findings are resolved
    assignees: [],
  },
  llm: {
    agent_hint: "codex",
    pr_branch_prefix: "vibecheck/fix-",
  },
};

// ============================================================================
// Repo Detection Types
// ============================================================================

export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "other";
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun" | "unknown";

export interface RepoProfile {
  languages: Language[];
  packageManager: PackageManager;
  isMonorepo: boolean;
  workspacePackages: string[];
  hasTypeScript: boolean;
  hasEslint: boolean;
  hasPrettier: boolean;
  hasTrunk: boolean;
  hasDependencyCruiser: boolean;
  hasKnip: boolean;
  rootPath: string;
  // Python/Java detection
  hasPython: boolean;
  hasJava: boolean;
  hasRuff: boolean;
  hasMypy: boolean;
  hasPmd: boolean;
  hasSpotBugs: boolean;
}

// ============================================================================
// Finding Types (internal model)
// ============================================================================

export interface Location {
  path: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Evidence {
  snippet?: string;
  links?: string[];
}

export interface SuggestedFix {
  goal: string;
  steps: string[];
  acceptance: string[];
}

export type ToolName =
  | "eslint"
  | "tsc"
  | "prettier"
  | "jscpd"
  | "dependency-cruiser"
  | "knip"
  | "semgrep"
  | "trunk"
  | "ruff"
  | "mypy"
  | "bandit"
  | "pmd"
  | "spotbugs"
  | "custom";

export interface Finding {
  fingerprint: string;
  layer: Layer;
  tool: ToolName;
  ruleId: string;
  title: string;
  message: string;
  severity: Severity;
  confidence: Confidence;
  autofix: AutofixLevel;
  locations: Location[];
  evidence?: Evidence;
  suggestedFix?: SuggestedFix;
  labels: string[];
  // Internal tracking
  rawOutput?: unknown;
}

// ============================================================================
// LLM JSON Output Types (results.llm.json)
// ============================================================================

export interface RepoInfo {
  owner: string;
  name: string;
  defaultBranch: string;
  commit: string;
}

export interface LlmJsonSummary {
  totalFindings: number; // Raw count before deduplication/merging
  uniqueFindings: number; // After deduplication
  mergedFindings: number; // After merging (used for issues)
  highConfidence: number;
  actionable: number;
  bySeverity: Record<Severity, number>;
  byTool: Record<string, number>;
  // Issue stats (populated after issue processing)
  issuesCreated?: number;
  issuesUpdated?: number;
  issuesClosed?: number;
}

export interface LlmJsonOutput {
  version: number;
  repo: RepoInfo;
  generatedAt: string;
  profile: Pick<RepoProfile, "isMonorepo" | "languages" | "packageManager">;
  summary: LlmJsonSummary;
  findings: Omit<Finding, "rawOutput">[];
}

// ============================================================================
// SARIF Types (subset of SARIF 2.1.0)
// ============================================================================

export interface SarifMessage {
  text: string;
}

interface SarifArtifactLocation {
  uri: string;
  uriBaseId?: string;
}

interface SarifRegion {
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

export interface SarifResult {
  ruleId: string;
  level: "none" | "note" | "warning" | "error";
  message: SarifMessage;
  locations: SarifLocation[];
  fingerprints?: Record<string, string>;
  properties?: {
    confidence?: Confidence;
    autofix?: AutofixLevel;
    layer?: Layer;
    [key: string]: unknown;
  };
}

export interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: SarifMessage;
  fullDescription?: SarifMessage;
  helpUri?: string;
  defaultConfiguration?: {
    level?: "none" | "note" | "warning" | "error";
  };
  properties?: Record<string, unknown>;
}

interface SarifToolDriver {
  name: string;
  version?: string;
  informationUri?: string;
  rules?: SarifRule[];
}

export interface SarifTool {
  driver: SarifToolDriver;
}

export interface SarifInvocation {
  executionSuccessful: boolean;
  commandLine?: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  workingDirectory?: SarifArtifactLocation;
}

export interface SarifRun {
  tool: SarifTool;
  invocations?: SarifInvocation[];
  results: SarifResult[];
}

export interface SarifLog {
  version: "2.1.0";
  $schema: string;
  runs: SarifRun[];
}

// ============================================================================
// GitHub Issue Types
// ============================================================================

export interface IssueMetadata {
  fingerprint: string;
  lastSeenRun: number;
  consecutiveMisses: number;
}

export interface ExistingIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  metadata?: IssueMetadata;
}

export interface IssueCreateParams {
  title: string;
  body: string;
  labels: string[];
  assignees?: string[];
}

export interface IssueUpdateParams {
  number: number;
  title?: string;
  body?: string;
  labels?: string[];
  state?: "open" | "closed";
}

// ============================================================================
// Tool Output Types (raw outputs from various tools)
// ============================================================================

export interface TscDiagnostic {
  file: string;
  line: number;
  column: number;
  code: number;
  message: string;
}

export interface JscpdClone {
  format: string;
  lines: number;
  tokens: number;
  firstFile: {
    name: string;
    start: number;
    end: number;
    startLoc: { line: number; column: number };
    endLoc: { line: number; column: number };
  };
  secondFile: {
    name: string;
    start: number;
    end: number;
    startLoc: { line: number; column: number };
    endLoc: { line: number; column: number };
  };
  fragment?: string;
}

export interface JscpdOutput {
  duplicates: JscpdClone[];
  statistics: {
    total: {
      lines: number;
      tokens: number;
      sources: number;
      clones: number;
      duplicatedLines: number;
      duplicatedTokens: number;
      percentage: number;
    };
  };
}

// ============================================================================
// Run Context (passed through the pipeline)
// ============================================================================

export interface RunContext {
  repo: RepoInfo;
  profile: RepoProfile;
  config: VibeCopConfig;
  cadence: Cadence;
  runNumber: number;
  workspacePath: string;
  outputDir: string;
}
