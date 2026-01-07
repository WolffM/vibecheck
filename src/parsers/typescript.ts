/**
 * TypeScript/JavaScript Tool Parsers
 *
 * Parsers for TypeScript and JavaScript analysis tools:
 * - tsc (TypeScript compiler)
 * - jscpd (copy-paste detector)
 * - dependency-cruiser (architecture)
 * - knip (dead code)
 * - trunk (meta-linter wrapping ESLint, etc.)
 */

import { fingerprintFinding } from "../utils/fingerprints.js";
import {
  buildLocation,
  createFinding,
  normalizePath,
  parseResults,
} from "../utils/parser-utils.js";
import {
  mapDepcruiseConfidence,
  mapDepcruiseSeverity,
  mapJscpdConfidence,
  mapJscpdSeverity,
  mapKnipConfidence,
  mapKnipSeverity,
  mapTscConfidence,
  mapTscSeverity,
} from "../scoring.js";
import type { Finding, JscpdOutput, Location, TscDiagnostic } from "../core/types.js";

// ============================================================================
// TypeScript Compiler Parser
// ============================================================================

/**
 * Parse TypeScript compiler diagnostics into Findings.
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
// jscpd Parser (Copy-Paste Detection)
// ============================================================================

/**
 * Parse jscpd JSON output into Findings.
 */
export function parseJscpdOutput(output: JscpdOutput): Finding[] {
  const findings: Finding[] = [];

  for (const clone of output.duplicates) {
    const file1Path = normalizePath(clone.firstFile.name);
    const file2Path = normalizePath(clone.secondFile.name);

    const location1: Location = {
      path: file1Path,
      startLine: clone.firstFile.startLoc.line,
      startColumn: clone.firstFile.startLoc.column,
      endLine: clone.firstFile.endLoc.line,
      endColumn: clone.firstFile.endLoc.column,
    };

    const location2: Location = {
      path: file2Path,
      startLine: clone.secondFile.startLoc.line,
      startColumn: clone.secondFile.startLoc.column,
      endLine: clone.secondFile.endLoc.line,
      endColumn: clone.secondFile.endLoc.column,
    };

    const severity = mapJscpdSeverity(clone.lines, clone.tokens);
    const confidence = mapJscpdConfidence(clone.tokens);

    const finding: Omit<Finding, "fingerprint"> = {
      layer: "code",
      tool: "jscpd",
      ruleId: "duplicate-code",
      title: `Duplicate Code: ${clone.lines} lines`,
      message: `Found ${clone.lines} duplicate lines (${clone.tokens} tokens) between ${file1Path} and ${file2Path}`,
      severity,
      confidence,
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
      location: buildLocation(violation.from, 1),
      layer: "architecture",
    });
  });
}

// ============================================================================
// knip Parser (Dead Code Detection)
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
  const normalizedPath = normalizePath(filePath);
  const location: Location = { path: normalizedPath, startLine: line };
  const severity = mapKnipSeverity(type);
  const confidence = mapKnipConfidence(type);

  let message: string;
  let title: string;
  switch (type) {
    case "files":
      message = `Unused file: ${normalizedPath}`;
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
      message = `Unused export: ${symbol} in ${normalizedPath}`;
      title = "Unused Export";
      break;
    case "types":
      message = `Unused type: ${symbol} in ${normalizedPath}`;
      title = "Unused Type";
      break;
    case "unlisted":
      message = `Unlisted dependency: ${symbol} used in ${normalizedPath}`;
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
    autofix: "none",
    locations: [location],
    labels: ["vibeCheck", "tool:knip", `severity:${severity}`],
    rawOutput: { type, filePath: normalizedPath, symbol, line },
  };

  return {
    ...finding,
    fingerprint: fingerprintFinding(finding),
  };
}

// ============================================================================
// Trunk Parser (Meta-Linter)
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

/** Map Trunk level to severity, with linter-specific adjustments */
function mapTrunkSeverity(level: string, linter?: string): Finding["severity"] {
  const normalized = level.toLowerCase().replace("level_", "");
  
  // Style-focused linters: cap severity at medium
  if (linter) {
    const linterLower = linter.toLowerCase();
    if (["yamllint", "markdownlint", "prettier"].includes(linterLower)) {
      if (normalized === "high" || normalized === "error") {
        return "medium";
      }
    }
  }
  
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
      severity: mapTrunkSeverity(issue.level, issue.linter),
      confidence: mapTrunkConfidence(issue.linter),
      location: buildLocation(issue.file, issue.line, issue.column),
      extraLabels: [`linter:${issue.linter}`],
    });
  });
}
