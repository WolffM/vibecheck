/**
 * Kotlin Tool Parsers
 *
 * Parsers for Kotlin analysis tools: detekt
 */

import type { Finding, Severity, Confidence } from "../core/types.js";
import { normalizePath } from "../utils/parser-utils.js";

/** detekt SARIF output structure (simplified) */
export interface DetektSarifOutput {
  runs: DetektSarifRun[];
}

interface DetektSarifRun {
  tool: {
    driver: {
      name: string;
      rules?: { id: string; shortDescription?: { text: string } }[];
    };
  };
  results?: DetektSarifResult[];
}

interface DetektSarifResult {
  ruleId: string;
  level?: string;
  message: { text: string };
  locations: {
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }[];
}

/**
 * Map detekt severity to vibeCheck severity.
 * detekt uses: error, warning, info
 */
function mapDetektSeverity(level: string | undefined): Severity {
  switch (level) {
    case "error":
      return "high";
    case "warning":
      return "medium";
    case "info":
      return "low";
    default:
      return "medium";
  }
}

/**
 * Parse detekt SARIF output into findings.
 */
export function parseDetektOutput(
  output: DetektSarifOutput,
  rootPath: string,
): Finding[] {
  const findings: Finding[] = [];

  if (!output.runs) return findings;

  for (const run of output.runs) {
    if (!run.results) continue;

    for (const result of run.results) {
      const location = result.locations?.[0];
      if (!location) continue;

      const rawUri = location.physicalLocation?.artifactLocation?.uri || "unknown";
      // detekt SARIF can emit file:// URIs or CI-absolute paths — normalize to
      // repo-relative so paths match the other tools' findings.
      const filePath = normalizePath(rawUri.replace(/^file:\/\//, ""), rootPath);
      const line = location.physicalLocation?.region?.startLine || 0;

      const severity = mapDetektSeverity(result.level);
      const ruleId = result.ruleId || "detekt";
      const message = result.message?.text || ruleId;

      findings.push({
        fingerprint: `detekt|${ruleId}|${filePath}|${line}`,
        layer: "code" as const,
        tool: "detekt",
        ruleId,
        title: `${ruleId}: ${message.slice(0, 80)}`,
        message,
        severity,
        confidence: "high" as Confidence,
        autofix: "none" as const,
        locations: [
          {
            path: filePath,
            startLine: line,
            endLine: line,
          },
        ],
        labels: ["detekt", `severity:${severity}`, "layer:code"],
      });
    }
  }

  return findings;
}
