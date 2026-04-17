import { describe, expect, it, vi } from "vitest";
import {
  prepareAndLogFindingsForProcessing,
  prepareFindingsForProcessing,
} from "../src/utils/finding-processing.js";
import type { Finding } from "../src/core/types.js";

const baseFinding: Omit<Finding, "fingerprint"> = {
  layer: "code",
  tool: "eslint",
  ruleId: "no-unused-vars",
  title: "Unused variable",
  message: "Variable is declared but never used",
  severity: "medium",
  confidence: "high",
  autofix: "safe",
  locations: [{ path: "src/app.ts", startLine: 10 }],
  labels: ["vibeCheck"],
};

describe("prepareFindingsForProcessing", () => {
  it("deduplicates, filters, and sorts findings", () => {
    const findings: Finding[] = [
      {
        ...baseFinding,
        fingerprint: "same",
      },
      {
        ...baseFinding,
        fingerprint: "same",
      },
      {
        ...baseFinding,
        ruleId: "no-eval",
        severity: "high",
        locations: [{ path: "src/a.ts", startLine: 1 }],
        fingerprint: "high",
      },
      {
        ...baseFinding,
        ruleId: "semi",
        severity: "low",
        confidence: "low",
        fingerprint: "low",
      },
    ];

    const result = prepareFindingsForProcessing(findings, "medium", "medium");

    expect(result.uniqueFindings).toHaveLength(3);
    expect(result.filteredFindings).toHaveLength(2);
    expect(result.skippedBelowThreshold).toBe(1);
    expect(result.actionableFindings.map((f) => f.fingerprint)).toEqual([
      "high",
      "same",
    ]);
  });
});

describe("prepareAndLogFindingsForProcessing", () => {
  it("logs summary counts and returns prepared findings", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const findings: Finding[] = [{ ...baseFinding, fingerprint: "fp" }];

    const result = prepareAndLogFindingsForProcessing(findings, "low", "low");

    expect(result.uniqueFindings).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith("Processing 1 unique findings");
    expect(spy).toHaveBeenCalledWith("1 findings meet thresholds");
    spy.mockRestore();
  });
});
