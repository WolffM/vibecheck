/**
 * Tool Output Parsers
 *
 * Parses raw output from various tools into the unified Finding model.
 *
 * Reference: vibeCheck_spec.md sections 6, 7
 */

import { fingerprintFinding } from "./fingerprints.js";
import {
  buildLocation,
  buildLocationFromRowCol,
  createFinding,
  parseResults,
} from "./parser-utils.js";
import {
  determineAutofixLevel,
  estimateEffort,
  mapBanditConfidence,
  mapBanditSeverity,
  mapDepcruiseConfidence,
  mapDepcruiseSeverity,
  mapJscpdConfidence,
  mapJscpdSeverity,
  mapKnipConfidence,
  mapKnipSeverity,
  mapMypyConfidence,
  mapMypySeverity,
  mapPmdConfidence,
  mapPmdSeverity,
  mapRuffConfidence,
  mapRuffSeverity,
  mapSemgrepConfidence,
  mapSemgrepSeverity,
  mapSpotBugsConfidence,
  mapSpotBugsSeverity,
  mapTscConfidence,
  mapTscSeverity,
} from "./scoring.js";
import type { Finding, JscpdOutput, Location, TscDiagnostic } from "./types.js";

// ============================================================================
// TypeScript Parser
// ============================================================================

/**
 * Parse TypeScript compiler diagnostics into Findings.
 * Expected input format (from tsc --pretty false):
 * file.ts(line,col): error TSxxxx: message
 */
export function parseTscOutput(diagnostics: TscDiagnostic[]): Finding[] {
  return parseResults(diagnostics, (diag) => {
    const ruleId = `TS${diag.code}`;
    return createFinding({
      result: diag,
      tool: "tsc",
      ruleId,
      title: `TypeScript: ${ruleId}`,
      message: diag.message,
      severity: mapTscSeverity(diag.code),
      confidence: mapTscConfidence(diag.code),
      location: buildLocation(diag.file, diag.line, diag.column),
    });
  });
}

/**
 * Parse tsc text output into TscDiagnostic objects.
 * Format: file.ts(line,col): error TSxxxx: message
 */
export function parseTscTextOutput(output: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  const lines = output.split("\n");

  // Match: file.ts(line,col): error TSxxxx: message
  const pattern = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)$/;

  for (const line of lines) {
    const match = pattern.exec(line.trim());
    if (match) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: parseInt(match[4], 10),
        message: match[5],
      });
    }
  }

  return diagnostics;
}

// ============================================================================
// jscpd Parser
// ============================================================================

/**
 * Parse jscpd JSON output into Findings.
 */
export function parseJscpdOutput(output: JscpdOutput): Finding[] {
  const findings: Finding[] = [];

  for (const clone of output.duplicates) {
    const location1: Location = {
      path: clone.firstFile.name,
      startLine: clone.firstFile.startLoc.line,
      startColumn: clone.firstFile.startLoc.column,
      endLine: clone.firstFile.endLoc.line,
      endColumn: clone.firstFile.endLoc.column,
    };

    const location2: Location = {
      path: clone.secondFile.name,
      startLine: clone.secondFile.startLoc.line,
      startColumn: clone.secondFile.startLoc.column,
      endLine: clone.secondFile.endLoc.line,
      endColumn: clone.secondFile.endLoc.column,
    };

    const severity = mapJscpdSeverity(clone.lines, clone.tokens);
    const confidence = mapJscpdConfidence(clone.tokens);
    const effort = estimateEffort("jscpd", "duplicate-code", 2, false);

    const finding: Omit<Finding, "fingerprint"> = {
      layer: "code",
      tool: "jscpd",
      ruleId: "duplicate-code",
      title: `Duplicate Code: ${clone.lines} lines`,
      message: `Found ${clone.lines} duplicate lines (${clone.tokens} tokens) between ${clone.firstFile.name} and ${clone.secondFile.name}`,
      severity,
      confidence,
      effort,
      autofix: "none",
      locations: [location1, location2],
      evidence: clone.fragment ? { snippet: clone.fragment } : undefined,
      labels: ["vibeCheck", "tool:jscpd", `severity:${severity}`, "duplicates"],
      rawOutput: clone,
    };

    findings.push({
      ...finding,
      fingerprint: fingerprintFinding(finding),
    });
  }

  return findings;
}

// ============================================================================
// dependency-cruiser Parser
// ============================================================================

interface DepcruiseViolation {
  type?: string;
  from: string;
  to: string;
  rule: {
    name: string;
    severity: string;
  };
  cycle?: Array<{ name: string; dependencyTypes: string[] }>;
}

export interface DepcruiseOutput {
  summary?: {
    violations: DepcruiseViolation[];
  };
  violations?: DepcruiseViolation[];
}

/**
 * Parse dependency-cruiser JSON output into Findings.
 */
export function parseDepcruiseOutput(output: DepcruiseOutput): Finding[] {
  // Handle both top-level violations and summary.violations
  const violations = output.violations || output.summary?.violations || [];

  return parseResults(violations, (violation) => {
    const violationType = violation.type || violation.rule.name;
    let message = `Dependency violation: ${violation.from} -> ${violation.to}`;
    if (violation.cycle) {
      const cycleNames = violation.cycle.map((c) => c.name);
      message = `Circular dependency detected: ${[violation.from, ...cycleNames].join(" -> ")}`;
    }

    return createFinding({
      result: violation,
      tool: "dependency-cruiser",
      ruleId: violation.rule.name,
      title: `Dependency: ${violation.rule.name}`,
      message,
      severity: mapDepcruiseSeverity(violationType),
      confidence: mapDepcruiseConfidence(violationType),
      location: buildLocation(violation.from, 1), // dependency-cruiser doesn't provide line numbers
      layer: "architecture",
    });
  });
}

// ============================================================================
// knip Parser
// ============================================================================

interface KnipIssueItem {
  name: string;
  line?: number;
  col?: number;
  pos?: number;
}

interface KnipFileIssues {
  file: string;
  dependencies: KnipIssueItem[];
  devDependencies: KnipIssueItem[];
  optionalPeerDependencies: KnipIssueItem[];
  unlisted: KnipIssueItem[];
  binaries: KnipIssueItem[];
  unresolved: KnipIssueItem[];
  exports: KnipIssueItem[];
  types: KnipIssueItem[];
  enumMembers: Record<string, unknown>;
  duplicates: KnipIssueItem[];
  catalog: unknown[];
}

export interface KnipOutput {
  files: string[];
  issues: KnipFileIssues[];
}

/**
 * Parse knip JSON output into Findings.
 */
export function parseKnipOutput(output: KnipOutput): Finding[] {
  const findings: Finding[] = [];

  // Handle unused files
  for (const file of output.files || []) {
    const finding = createKnipFinding("files", file, "unused-file", 1);
    findings.push(finding);
  }

  // Handle per-file issues
  for (const fileIssues of output.issues || []) {
    const filePath = fileIssues.file;

    // Unused exports
    for (const exp of fileIssues.exports || []) {
      findings.push(
        createKnipFinding("exports", filePath, exp.name, exp.line ?? 1),
      );
    }

    // Unused types
    for (const type of fileIssues.types || []) {
      findings.push(
        createKnipFinding("types", filePath, type.name, type.line ?? 1),
      );
    }

    // Unused dependencies
    for (const dep of fileIssues.dependencies || []) {
      findings.push(
        createKnipFinding("dependencies", filePath, dep.name, dep.line ?? 1),
      );
    }

    // Unused dev dependencies
    for (const dep of fileIssues.devDependencies || []) {
      findings.push(
        createKnipFinding("devDependencies", filePath, dep.name, dep.line ?? 1),
      );
    }

    // Unlisted dependencies
    for (const dep of fileIssues.unlisted || []) {
      findings.push(
        createKnipFinding("unlisted", filePath, dep.name, dep.line ?? 1),
      );
    }

    // Duplicates
    for (const dup of fileIssues.duplicates || []) {
      findings.push(
        createKnipFinding("duplicates", filePath, dup.name, dup.line ?? 1),
      );
    }
  }

  return findings;
}

function createKnipFinding(
  type: string,
  filePath: string,
  symbol: string,
  line: number,
): Finding {
  const location: Location = {
    path: filePath,
    startLine: line,
  };

  const severity = mapKnipSeverity(type);
  const confidence = mapKnipConfidence(type);
  const effort = estimateEffort("knip", type, 1, false);

  let message: string;
  let title: string;
  switch (type) {
    case "files":
      message = `Unused file: ${filePath}`;
      title = "Unused File";
      break;
    case "dependencies":
      message = `Unused dependency: ${symbol}`;
      title = "Unused Dependency";
      break;
    case "devDependencies":
      message = `Unused dev dependency: ${symbol}`;
      title = "Unused Dev Dependency";
      break;
    case "exports":
      message = `Unused export: ${symbol} in ${filePath}`;
      title = "Unused Export";
      break;
    case "types":
      message = `Unused type: ${symbol} in ${filePath}`;
      title = "Unused Type";
      break;
    case "unlisted":
      message = `Unlisted dependency: ${symbol} used in ${filePath}`;
      title = "Unlisted Dependency";
      break;
    case "duplicates":
      message = `Duplicate export: ${symbol}`;
      title = "Duplicate Export";
      break;
    default:
      message = `Knip issue: ${type} - ${symbol}`;
      title = `Knip: ${type}`;
  }

  const finding: Omit<Finding, "fingerprint"> = {
    layer: "architecture",
    tool: "knip",
    ruleId: type,
    title,
    message,
    severity,
    confidence,
    effort,
    autofix: "none",
    locations: [location],
    labels: ["vibeCheck", "tool:knip", `severity:${severity}`],
    rawOutput: { type, filePath, symbol, line },
  };

  return {
    ...finding,
    fingerprint: fingerprintFinding(finding),
  };
}

// ============================================================================
// Semgrep Parser
// ============================================================================

interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    metadata?: {
      confidence?: string;
      [key: string]: unknown;
    };
    fix?: string;
    lines?: string;
  };
}

export interface SemgrepOutput {
  results: SemgrepResult[];
}

/**
 * Parse semgrep JSON output into Findings.
 */
export function parseSemgrepOutput(output: SemgrepOutput): Finding[] {
  return parseResults(output.results, (result) => {
    const hasAutofix = !!result.extra.fix;
    return createFinding({
      result,
      tool: "semgrep",
      ruleId: result.check_id,
      title: `Semgrep: ${result.check_id}`,
      message: result.extra.message,
      severity: mapSemgrepSeverity(result.extra.severity),
      confidence: mapSemgrepConfidence(
        result.extra.metadata?.confidence as string | undefined,
      ),
      location: buildLocation(
        result.path,
        result.start.line,
        result.start.col,
        result.end.line,
        result.end.col,
      ),
      hasAutofix,
      evidence: result.extra.lines
        ? { snippet: result.extra.lines }
        : undefined,
    });
  });
}

// ============================================================================
// Trunk Parser
// ============================================================================

interface TrunkIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  code: string;
  linter: string;
  level: string;
  targetType?: string;
}

export interface TrunkOutput {
  issues: TrunkIssue[];
}

/** Map Trunk level to severity */
function mapTrunkSeverity(level: string): Finding["severity"] {
  const normalized = level.toLowerCase().replace("level_", "");
  switch (normalized) {
    case "high":
    case "error":
      return "high";
    case "medium":
    case "warning":
      return "medium";
    default:
      return "low";
  }
}

/** Map Trunk linter to confidence */
function mapTrunkConfidence(linter: string): Finding["confidence"] {
  return ["tsc", "typescript"].includes(linter.toLowerCase())
    ? "high"
    : "medium";
}

/**
 * Parse Trunk check JSON output into Findings.
 */
export function parseTrunkOutput(output: TrunkOutput): Finding[] {
  return parseResults(output.issues, (issue) => {
    const ruleId = issue.code || `${issue.linter}/unknown`;
    return createFinding({
      result: issue,
      tool: "trunk",
      ruleId,
      title: `${issue.linter}: ${issue.code || "issue"}`,
      message: issue.message,
      severity: mapTrunkSeverity(issue.level),
      confidence: mapTrunkConfidence(issue.linter),
      location: buildLocation(issue.file, issue.line, issue.column),
      extraLabels: [`linter:${issue.linter}`],
    });
  });
}

// ============================================================================
// Python Tool Parsers
// ============================================================================

// Ruff JSON output types
interface RuffResult {
  code: string;
  message: string;
  filename: string;
  location: {
    row: number;
    column: number;
  };
  end_location: {
    row: number;
    column: number;
  };
  fix?: {
    applicability: string;
    message: string;
    edits: Array<{
      content: string;
      location: { row: number; column: number };
      end_location: { row: number; column: number };
    }>;
  };
  noqa_row?: number;
  url?: string;
}

/**
 * Parse Ruff JSON output into Findings.
 * Ruff outputs JSON with --output-format json
 */
export function parseRuffOutput(output: RuffResult[]): Finding[] {
  return parseResults(output, (result) => {
    const hasAutofix = !!result.fix;
    return createFinding({
      result,
      tool: "ruff",
      ruleId: result.code,
      title: `Ruff: ${result.code}`,
      message: result.message,
      severity: mapRuffSeverity(result.code),
      confidence: mapRuffConfidence(result.code),
      location: buildLocationFromRowCol(
        result.filename,
        result.location,
        result.end_location,
      ),
      hasAutofix,
      autofix: determineAutofixLevel("ruff", result.code, hasAutofix),
    });
  });
}

// Mypy JSON output types
interface MypyError {
  file: string;
  line: number;
  column: number;
  message: string;
  hint: string | null;
  code: string | null;
  severity: string;
}

/**
 * Parse Mypy JSON output into Findings.
 * Mypy outputs JSON with --output json (Python 3.10+) or via mypy-json-report plugin
 */
export function parseMypyOutput(errors: MypyError[]): Finding[] {
  return parseResults(errors, (error) => {
    // Skip notes unless they're relevant
    if (error.severity === "note" && !error.code) {
      return null;
    }

    const errorCode = error.code || "unknown";
    return createFinding({
      result: error,
      tool: "mypy",
      ruleId: errorCode,
      title: `Mypy: ${errorCode}`,
      message: error.message + (error.hint ? `\nHint: ${error.hint}` : ""),
      severity: mapMypySeverity(errorCode),
      confidence: mapMypyConfidence(errorCode),
      location: buildLocation(error.file, error.line, error.column),
    });
  });
}

// Bandit JSON output types
interface BanditResult {
  code: string;
  col_offset: number;
  end_col_offset: number;
  filename: string;
  issue_confidence: string;
  issue_severity: string;
  issue_cwe: { id: number; link: string };
  issue_text: string;
  line_number: number;
  line_range: number[];
  more_info: string;
  test_id: string;
  test_name: string;
}

export interface BanditOutput {
  errors: unknown[];
  generated_at: string;
  metrics: Record<string, unknown>;
  results: BanditResult[];
}

/**
 * Parse Bandit JSON output into Findings.
 * Bandit outputs JSON with -f json
 */
export function parseBanditOutput(output: BanditOutput): Finding[] {
  return parseResults(output.results, (result) =>
    createFinding({
      result,
      tool: "bandit",
      ruleId: result.test_id,
      title: `Bandit: ${result.test_name}`,
      message: result.issue_text,
      severity: mapBanditSeverity(result.issue_severity),
      confidence: mapBanditConfidence(result.issue_confidence),
      location: buildLocation(
        result.filename,
        result.line_number,
        result.col_offset,
        result.line_range.length > 0
          ? result.line_range[result.line_range.length - 1]
          : result.line_number,
        result.end_col_offset,
      ),
      layer: "security",
      evidence: {
        snippet: result.code,
        links: [result.more_info, result.issue_cwe.link].filter(Boolean),
      },
      extraLabels: [`cwe:${result.issue_cwe.id}`],
    }),
  );
}

// ============================================================================
// Java Tool Parsers
// ============================================================================

// PMD JSON output types
interface PmdViolation {
  beginline: number;
  begincolumn: number;
  endline: number;
  endcolumn: number;
  description: string;
  rule: string;
  ruleset: string;
  priority: number;
  externalInfoUrl: string;
}

interface PmdFileReport {
  filename: string;
  violations: PmdViolation[];
}

export interface PmdOutput {
  formatVersion: number;
  pmdVersion: string;
  timestamp: string;
  files: PmdFileReport[];
  processingErrors: unknown[];
  configurationErrors: unknown[];
}

/**
 * Parse PMD JSON output into Findings.
 * PMD outputs JSON with -f json
 */
export function parsePmdOutput(output: PmdOutput): Finding[] {
  const findings: Finding[] = [];

  for (const file of output.files) {
    const fileFindings = parseResults(file.violations, (violation) =>
      createFinding({
        result: violation,
        tool: "pmd",
        ruleId: violation.rule,
        title: `PMD: ${violation.rule}`,
        message: violation.description,
        severity: mapPmdSeverity(violation.priority),
        confidence: mapPmdConfidence(violation.ruleset),
        location: buildLocation(
          file.filename,
          violation.beginline,
          violation.begincolumn,
          violation.endline,
          violation.endcolumn,
        ),
        evidence: {
          links: violation.externalInfoUrl ? [violation.externalInfoUrl] : [],
        },
        extraLabels: [`ruleset:${violation.ruleset}`],
      }),
    );
    findings.push(...fileFindings);
  }

  return findings;
}

// SpotBugs SARIF output types (SpotBugs can output SARIF)
// We'll parse SARIF format since it's more standardized

interface SpotBugsSarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: {
        startLine: number;
        startColumn?: number;
        endLine?: number;
        endColumn?: number;
      };
    };
  }>;
  properties?: {
    category?: string;
    rank?: number;
    confidence?: number;
    [key: string]: unknown;
  };
}

interface SpotBugsSarifRun {
  tool: {
    driver: {
      name: string;
      version?: string;
      rules?: Array<{
        id: string;
        name?: string;
        shortDescription?: { text: string };
        fullDescription?: { text: string };
        helpUri?: string;
      }>;
    };
  };
  results: SpotBugsSarifResult[];
}

export interface SpotBugsSarifOutput {
  version: string;
  $schema: string;
  runs: SpotBugsSarifRun[];
}

/**
 * Parse SpotBugs SARIF output into Findings.
 * SpotBugs outputs SARIF with -sarif flag
 */
export function parseSpotBugsOutput(output: SpotBugsSarifOutput): Finding[] {
  const findings: Finding[] = [];

  for (const run of output.runs) {
    // Build rule lookup for descriptions
    const ruleMap = new Map<
      string,
      { name?: string; description?: string; helpUri?: string }
    >();
    for (const rule of run.tool.driver.rules || []) {
      ruleMap.set(rule.id, {
        name: rule.name,
        description: rule.shortDescription?.text || rule.fullDescription?.text,
        helpUri: rule.helpUri,
      });
    }

    const runFindings = parseResults(run.results, (result) => {
      const loc = result.locations[0]?.physicalLocation;
      if (!loc) return null;

      const rank = result.properties?.rank ?? 10;
      const category = result.properties?.category as string | undefined;
      const ruleInfo = ruleMap.get(result.ruleId);

      return createFinding({
        result,
        tool: "spotbugs",
        ruleId: result.ruleId,
        title: `SpotBugs: ${ruleInfo?.name || result.ruleId}`,
        message: result.message.text,
        severity: mapSpotBugsSeverity(rank, category),
        confidence: mapSpotBugsConfidence(result.properties?.confidence ?? 2),
        location: buildLocation(
          loc.artifactLocation.uri.replace(/^file:\/\//, ""),
          loc.region?.startLine ?? 1,
          loc.region?.startColumn,
          loc.region?.endLine,
          loc.region?.endColumn,
        ),
        evidence: ruleInfo?.helpUri ? { links: [ruleInfo.helpUri] } : undefined,
        extraLabels: category ? [`category:${category}`] : [],
      });
    });
    findings.push(...runFindings);
  }

  return findings;
}
