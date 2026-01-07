/**
 * SARIF Builder
 *
 * Converts internal Finding[] model to SARIF 2.1.0 format.
 *
 * Reference: vibeCheck_spec.md section 6.1
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadFindingsAndContext } from "../utils/cli-utils.js";
import type {
  Finding,
  RunContext,
  SarifLog,
  SarifResult,
  SarifRule,
  SarifRun,
  Severity,
} from "../core/types.js";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

/**
 * Map our severity to SARIF level.
 */
function severityToSarifLevel(severity: Severity): SarifResult["level"] {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
    default:
      return "warning";
  }
}

/**
 * Group findings by tool for separate SARIF runs.
 */
function groupFindingsByTool(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const tool = finding.tool;
    const existing = groups.get(tool);
    if (existing) {
      existing.push(finding);
    } else {
      groups.set(tool, [finding]);
    }
  }
  return groups;
}

/**
 * Extract unique rules from findings.
 */
function extractRules(findings: Finding[]): SarifRule[] {
  const ruleMap = new Map<string, SarifRule>();

  for (const finding of findings) {
    if (!ruleMap.has(finding.ruleId)) {
      ruleMap.set(finding.ruleId, {
        id: finding.ruleId,
        name: finding.ruleId,
        shortDescription: { text: finding.title },
        defaultConfiguration: {
          level: severityToSarifLevel(finding.severity),
        },
        properties: {
          confidence: finding.confidence,
          layer: finding.layer,
        },
      });
    }
  }

  return Array.from(ruleMap.values());
}

/**
 * Convert a Finding to a SARIF Result.
 */
function findingToSarifResult(finding: Finding): SarifResult {
  return {
    ruleId: finding.ruleId,
    level: severityToSarifLevel(finding.severity),
    message: { text: finding.message },
    locations: finding.locations.map((loc) => ({
      physicalLocation: {
        artifactLocation: {
          uri: loc.path.replace(/\\/g, "/"),
          uriBaseId: "%SRCROOT%",
        },
        region: {
          startLine: Number(loc.startLine) || 1,
          startColumn: Number(loc.startColumn) || 1,
          endLine: Number(loc.endLine) || Number(loc.startLine) || 1,
          endColumn: Number(loc.endColumn) || 1,
        },
      },
    })),
    fingerprints: {
      vibeCheckFingerprint: finding.fingerprint,
    },
    properties: {
      confidence: finding.confidence,
      autofix: finding.autofix,
      layer: finding.layer,
      labels: finding.labels,
    },
  };
}

/**
 * Build a SARIF run for a specific tool.
 */
function buildSarifRun(
  toolName: string,
  findings: Finding[],
  context: RunContext,
): SarifRun {
  const rules = extractRules(findings);
  const results = findings.map(findingToSarifResult);

  return {
    tool: {
      driver: {
        name: `vibeCheck/${toolName}`,
        version: "0.1.0",
        informationUri: "https://github.com/<OWNER>/vibeCheck",
        rules,
      },
    },
    invocations: [
      {
        executionSuccessful: true,
        startTimeUtc: new Date().toISOString(),
        workingDirectory: {
          uri: context.workspacePath.replace(/\\/g, "/"),
        },
      },
    ],
    results,
  };
}

/**
 * Build complete SARIF log from findings.
 */
export function buildSarifLog(
  findings: Finding[],
  context: RunContext,
): SarifLog {
  const groupedFindings = groupFindingsByTool(findings);
  const runs: SarifRun[] = [];

  for (const [toolName, toolFindings] of groupedFindings) {
    runs.push(buildSarifRun(toolName, toolFindings, context));
  }

  // If no findings, create an empty run for vibeCheck
  if (runs.length === 0) {
    runs.push({
      tool: {
        driver: {
          name: "vibeCheck",
          version: "0.1.0",
          informationUri: "https://github.com/<OWNER>/vibeCheck",
        },
      },
      results: [],
    });
  }

  return {
    version: "2.1.0",
    $schema: SARIF_SCHEMA,
    runs,
  };
}

/**
 * Write SARIF log to file.
 */
export function writeSarifFile(sarif: SarifLog, outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify(sarif, null, 2), "utf-8");
}

/**
 * Merge multiple SARIF logs into one.
 * Useful when combining outputs from multiple tool runs.
 */
export function mergeSarifLogs(logs: SarifLog[]): SarifLog {
  const runs: SarifRun[] = [];
  for (const log of logs) {
    runs.push(...log.runs);
  }

  return {
    version: "2.1.0",
    $schema: SARIF_SCHEMA,
    runs,
  };
}

/**
 * Load existing SARIF file if present.
 */
export function loadSarifFile(path: string): SarifLog | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as SarifLog;
  } catch {
    return null;
  }
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const findingsPath = args[0] || "findings.json";
  const outputPath = args[1] || "results.sarif";
  const contextPath = args[2] || "context.json";

  const { findings, context } = loadFindingsAndContext(
    findingsPath,
    contextPath,
  );

  // Build and write SARIF
  const sarif = buildSarifLog(findings, context);
  writeSarifFile(sarif, outputPath);

  console.log(`SARIF output written to: ${outputPath}`);
  console.log(`Total runs: ${sarif.runs.length}`);
  console.log(
    `Total results: ${sarif.runs.reduce((sum, run) => sum + run.results.length, 0)}`,
  );
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
