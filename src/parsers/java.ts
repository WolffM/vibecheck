/**
 * Java Tool Parsers
 *
 * Parsers for Java analysis tools:
 * - PMD (static analyzer)
 * - SpotBugs (bytecode analyzer)
 */

import { buildLocation, createFinding, parseResults } from "../utils/parser-utils.js";
import {
  mapPmdConfidence,
  mapPmdSeverity,
  mapSpotBugsConfidence,
  mapSpotBugsSeverity,
} from "../scoring.js";
import type { Finding } from "../core/types.js";

// ============================================================================
// PMD Parser (Static Analyzer)
// ============================================================================

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

// ============================================================================
// SpotBugs Parser (Bytecode Analyzer - SARIF format)
// ============================================================================

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
