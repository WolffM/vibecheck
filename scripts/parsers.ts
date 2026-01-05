/**
 * Tool Output Parsers
 *
 * Parses raw output from various tools into the unified Finding model.
 *
 * Reference: vibeCop_spec.md sections 6, 7
 */

import { fingerprintFinding } from "./fingerprints.js";
import {
  classifyLayer,
  estimateEffort,
  mapDepcruiseConfidence,
  mapDepcruiseSeverity,
  mapJscpdConfidence,
  mapJscpdSeverity,
  mapKnipConfidence,
  mapKnipSeverity,
  mapSemgrepConfidence,
  mapSemgrepSeverity,
  mapTscConfidence,
  mapTscSeverity,
} from "./scoring.js";
import type {
  Finding,
  JscpdOutput,
  Location,
  TscDiagnostic,
} from "./types.js";

// ============================================================================
// TypeScript Parser
// ============================================================================

/**
 * Parse TypeScript compiler diagnostics into Findings.
 * Expected input format (from tsc --pretty false):
 * file.ts(line,col): error TSxxxx: message
 */
export function parseTscOutput(diagnostics: TscDiagnostic[]): Finding[] {
  const findings: Finding[] = [];

  for (const diag of diagnostics) {
    const location: Location = {
      path: diag.file,
      startLine: diag.line,
      startColumn: diag.column,
    };

    const ruleId = `TS${diag.code}`;
    const severity = mapTscSeverity(diag.code);
    const confidence = mapTscConfidence(diag.code);
    const effort = estimateEffort("tsc", ruleId, 1, false);
    const layer = classifyLayer("tsc", ruleId);

    const finding: Omit<Finding, "fingerprint"> = {
      layer,
      tool: "tsc",
      ruleId,
      title: `TypeScript: ${ruleId}`, // Simplified title
      message: diag.message,
      severity,
      confidence,
      effort,
      autofix: "none",
      locations: [location],
      labels: ["vibeCop", "tool:tsc", `severity:${severity}`],
      rawOutput: diag,
    };

    findings.push({
      ...finding,
      fingerprint: fingerprintFinding(finding),
    });
  }

  return findings;
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
      labels: ["vibeCop", "tool:jscpd", `severity:${severity}`, "duplicates"],
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
  const findings: Finding[] = [];

  // Handle both top-level violations and summary.violations
  const violations = output.violations || output.summary?.violations || [];

  for (const violation of violations) {
    const location: Location = {
      path: violation.from,
      startLine: 1, // dependency-cruiser doesn't provide line numbers
    };

    const violationType = violation.type || violation.rule.name;
    const severity = mapDepcruiseSeverity(violationType);
    const confidence = mapDepcruiseConfidence(violationType);
    const effort = estimateEffort(
      "dependency-cruiser",
      violationType,
      1,
      false,
    );

    let message = `Dependency violation: ${violation.from} -> ${violation.to}`;
    if (violation.cycle) {
      const cycleNames = violation.cycle.map((c) => c.name);
      message = `Circular dependency detected: ${[violation.from, ...cycleNames].join(" -> ")}`;
    }

    const finding: Omit<Finding, "fingerprint"> = {
      layer: "architecture",
      tool: "dependency-cruiser",
      ruleId: violation.rule.name,
      title: `Dependency: ${violation.rule.name}`,
      message,
      severity,
      confidence,
      effort,
      autofix: "none",
      locations: [location],
      labels: ["vibeCop", "tool:dependency-cruiser", `severity:${severity}`],
      rawOutput: violation,
    };

    findings.push({
      ...finding,
      fingerprint: fingerprintFinding(finding),
    });
  }

  return findings;
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
    labels: ["vibeCop", "tool:knip", `severity:${severity}`],
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
  const findings: Finding[] = [];

  for (const result of output.results) {
    const location: Location = {
      path: result.path,
      startLine: result.start.line,
      startColumn: result.start.col,
      endLine: result.end.line,
      endColumn: result.end.col,
    };

    const severity = mapSemgrepSeverity(result.extra.severity);
    const confidence = mapSemgrepConfidence(
      result.extra.metadata?.confidence as string | undefined,
    );
    const hasAutofix = !!result.extra.fix;
    const autofix = hasAutofix ? "requires_review" : "none";
    const effort = estimateEffort("semgrep", result.check_id, 1, hasAutofix);
    const layer = classifyLayer("semgrep", result.check_id);

    const finding: Omit<Finding, "fingerprint"> = {
      layer,
      tool: "semgrep",
      ruleId: result.check_id,
      title: `Semgrep: ${result.check_id}`,
      message: result.extra.message,
      severity,
      confidence,
      effort,
      autofix,
      locations: [location],
      evidence: result.extra.lines
        ? { snippet: result.extra.lines }
        : undefined,
      labels: ["vibeCop", "tool:semgrep", `severity:${severity}`],
      rawOutput: result,
    };

    findings.push({
      ...finding,
      fingerprint: fingerprintFinding(finding),
    });
  }

  return findings;
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

/**
 * Parse Trunk check JSON output into Findings.
 */
export function parseTrunkOutput(output: TrunkOutput): Finding[] {
  const findings: Finding[] = [];

  for (const issue of output.issues) {
    const location: Location = {
      path: issue.file,
      startLine: issue.line,
      startColumn: issue.column,
    };

    // Map Trunk level to severity (handles LEVEL_HIGH, LEVEL_MEDIUM, LEVEL_LOW)
    let severity: Finding["severity"];
    const level = issue.level.toLowerCase().replace("level_", "");
    switch (level) {
      case "high":
      case "error":
        severity = "high";
        break;
      case "medium":
      case "warning":
        severity = "medium";
        break;
      default:
        severity = "low";
    }

    // Infer confidence based on linter
    let confidence: Finding["confidence"] = "medium";
    if (["tsc", "typescript"].includes(issue.linter.toLowerCase())) {
      confidence = "high";
    }

    const ruleId = issue.code || `${issue.linter}/unknown`;
    const layer = classifyLayer("trunk", ruleId);
    const effort = estimateEffort("trunk", ruleId, 1, false);

    const finding: Omit<Finding, "fingerprint"> = {
      layer,
      tool: "trunk",
      ruleId,
      title: `${issue.linter}: ${issue.code || "issue"}`,
      message: issue.message,
      severity,
      confidence,
      effort,
      autofix: "none",
      locations: [location],
      labels: [
        "vibeCop",
        `tool:trunk`,
        `linter:${issue.linter}`,
        `severity:${severity}`,
      ],
      rawOutput: issue,
    };

    findings.push({
      ...finding,
      fingerprint: fingerprintFinding(finding),
    });
  }

  return findings;
}
