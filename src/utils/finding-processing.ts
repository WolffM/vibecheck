import type { Confidence, Finding, Severity } from "../core/types.js";
import { prepareActionableFindings } from "../scoring/index.js";
import { deduplicateFindings } from "./fingerprints.js";

export interface PreparedFindings {
  uniqueFindings: Finding[];
  filteredFindings: Finding[];
  actionableFindings: Finding[];
  skippedBelowThreshold: number;
}

export function prepareFindingsForProcessing(
  findings: Finding[],
  severityThreshold: Severity | "info",
  confidenceThreshold: Confidence,
): PreparedFindings {
  const uniqueFindings = deduplicateFindings(findings);
  const { filteredFindings, actionableFindings, skippedBelowThreshold } =
    prepareActionableFindings(
      uniqueFindings,
      severityThreshold,
      confidenceThreshold,
    );

  return {
    uniqueFindings,
    filteredFindings,
    actionableFindings,
    skippedBelowThreshold,
  };
}

export function prepareAndLogFindingsForProcessing(
  findings: Finding[],
  severityThreshold: Severity | "info",
  confidenceThreshold: Confidence,
): PreparedFindings {
  const prepared = prepareFindingsForProcessing(
    findings,
    severityThreshold,
    confidenceThreshold,
  );

  console.log(`Processing ${prepared.uniqueFindings.length} unique findings`);
  console.log(`${prepared.filteredFindings.length} findings meet thresholds`);

  return prepared;
}
