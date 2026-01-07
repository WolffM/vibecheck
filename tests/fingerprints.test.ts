/**
 * Fingerprints Module Tests
 */

import { describe, it, expect } from "vitest";
import {
  bucketLine,
  normalizePath,
  normalizeMessage,
  normalizeRuleId,
  buildFingerprintKey,
  computeFingerprint,
  fingerprintFinding,
  shortFingerprint,
  extractFingerprintFromBody,
  generateFingerprintMarker,
  extractRunMetadata,
  generateRunMetadataMarker,
  fingerprintsMatch,
  groupByFingerprint,
  deduplicateFindings,
  LINE_BUCKET_SIZE,
} from "../src/utils/fingerprints.js";
import type { Finding } from "../src/core/types.js";

/** Create a test finding with optional overrides */
function createTestFinding(
  overrides: Partial<Omit<Finding, "fingerprint">> = {},
): Omit<Finding, "fingerprint"> {
  return {
    layer: "code",
    tool: "eslint",
    ruleId: "no-unused-vars",
    title: "Unused variable",
    message: "Variable x is declared but never used",
    severity: "medium",
    confidence: "high",
    autofix: "safe",
    locations: [{ path: "src/file.ts", startLine: 10 }],
    labels: ["vibeCheck"],
    ...overrides,
  };
}

describe("bucketLine", () => {
  it("should bucket lines to nearest 20", () => {
    expect(bucketLine(0)).toBe(0);
    expect(bucketLine(1)).toBe(0);
    expect(bucketLine(19)).toBe(0);
    expect(bucketLine(20)).toBe(20);
    expect(bucketLine(25)).toBe(20);
    expect(bucketLine(39)).toBe(20);
    expect(bucketLine(40)).toBe(40);
    expect(bucketLine(100)).toBe(100);
    expect(bucketLine(105)).toBe(100);
  });

  it("should use configured bucket size", () => {
    expect(LINE_BUCKET_SIZE).toBe(20);
  });
});

describe("normalizePath", () => {
  it("should convert backslashes to forward slashes", () => {
    expect(normalizePath("src\\utils\\helper.ts")).toBe("src/utils/helper.ts");
  });

  it("should remove leading ./", () => {
    expect(normalizePath("./src/file.ts")).toBe("src/file.ts");
  });

  it("should lowercase paths", () => {
    expect(normalizePath("Src/Utils/Helper.ts")).toBe("src/utils/helper.ts");
  });

  it("should handle combined transformations", () => {
    expect(normalizePath(".\\Src\\Utils\\Helper.ts")).toBe(
      "src/utils/helper.ts",
    );
  });
});

describe("normalizeMessage", () => {
  it("should collapse whitespace", () => {
    expect(normalizeMessage("multiple   spaces   here")).toBe(
      "multiple spaces here",
    );
  });

  it("should replace numbers with #", () => {
    expect(normalizeMessage("Error on line 42")).toBe("error on line #");
    expect(normalizeMessage("Found 123 issues in 456 files")).toBe(
      "found # issues in # files",
    );
  });

  it("should trim and lowercase", () => {
    expect(normalizeMessage("  Error Message  ")).toBe("error message");
  });
});

describe("normalizeRuleId", () => {
  it("should trim and lowercase", () => {
    expect(normalizeRuleId("  No-Unused-Vars  ")).toBe("no-unused-vars");
  });
});

describe("buildFingerprintKey", () => {
  it("should build consistent keys", () => {
    const key = buildFingerprintKey(
      "eslint",
      "no-unused-vars",
      "src/file.ts",
      25,
      "Variable x is not used",
    );

    expect(key).toBe(
      "eslint|no-unused-vars|src/file.ts|20|variable x is not used",
    );
  });

  it("should normalize all components", () => {
    const key = buildFingerprintKey(
      "ESLint",
      "No-Unused-Vars",
      ".\\Src\\File.ts",
      25,
      "  Variable 123 is not used  ",
    );

    expect(key).toBe(
      "eslint|no-unused-vars|src/file.ts|20|variable # is not used",
    );
  });
});

describe("computeFingerprint", () => {
  it("should return sha256 prefixed hash", () => {
    const fingerprint = computeFingerprint("test-key");
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("should be deterministic", () => {
    const fp1 = computeFingerprint("same-key");
    const fp2 = computeFingerprint("same-key");
    expect(fp1).toBe(fp2);
  });

  it("should differ for different inputs", () => {
    const fp1 = computeFingerprint("key-1");
    const fp2 = computeFingerprint("key-2");
    expect(fp1).not.toBe(fp2);
  });
});

describe("fingerprintFinding", () => {
  it("should generate fingerprint for finding with location", () => {
    const finding = createTestFinding();
    const fp = fingerprintFinding(finding);
    expect(fp).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("should generate fingerprint for finding without location", () => {
    const finding = createTestFinding({ locations: [] });
    const fp = fingerprintFinding(finding);
    expect(fp).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("should produce same fingerprint for similar findings", () => {
    const finding1 = createTestFinding();
    // Different line but same bucket (10 and 15 both bucket to 0)
    const finding2 = createTestFinding({
      locations: [{ path: "src/file.ts", startLine: 15 }],
    });

    expect(fingerprintFinding(finding1)).toBe(fingerprintFinding(finding2));
  });
});

describe("shortFingerprint", () => {
  it("should return first 12 chars of hash", () => {
    const fp =
      "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    expect(shortFingerprint(fp)).toBe("abcdef123456");
  });
});

describe("fingerprint markers", () => {
  it("should generate and extract fingerprint marker", () => {
    const fp = "sha256:abc123def456";
    const marker = generateFingerprintMarker(fp);
    expect(marker).toBe("<!-- vibecheck:fingerprint=sha256:abc123def456 -->");

    const extracted = extractFingerprintFromBody(
      `Some text\n${marker}\nMore text`,
    );
    expect(extracted).toBe(fp);
  });

  it("should return null for body without marker", () => {
    expect(extractFingerprintFromBody("No marker here")).toBeNull();
  });

  it("should extract legacy vibecop: fingerprint marker", () => {
    const legacyMarker = "<!-- vibecop:fingerprint=sha256:abc123def456 -->";
    const extracted = extractFingerprintFromBody(
      `Some text\n${legacyMarker}\nMore text`,
    );
    expect(extracted).toBe("sha256:abc123def456");
  });

  it("should generate and extract run metadata", () => {
    const marker = generateRunMetadataMarker(42, "2026-01-05T00:00:00Z");
    expect(marker).toBe(
      "<!-- vibecheck:run=42:lastSeen=2026-01-05T00:00:00Z -->",
    );

    const extracted = extractRunMetadata(`Some text\n${marker}\nMore text`);
    expect(extracted).toEqual({ run: 42, lastSeen: "2026-01-05T00:00:00Z" });
  });

  it("should return null for body without run metadata", () => {
    expect(extractRunMetadata("No metadata here")).toBeNull();
  });

  it("should extract legacy vibecop: run metadata", () => {
    const legacyMarker = "<!-- vibecop:run=42:lastSeen=2026-01-05T00:00:00Z -->";
    const extracted = extractRunMetadata(`Some text\n${legacyMarker}\nMore text`);
    expect(extracted).toEqual({ run: 42, lastSeen: "2026-01-05T00:00:00Z" });
  });
});

describe("fingerprintsMatch", () => {
  it("should match identical fingerprints", () => {
    expect(fingerprintsMatch("sha256:abc", "sha256:abc")).toBe(true);
  });

  it("should match case-insensitively", () => {
    expect(fingerprintsMatch("sha256:ABC", "sha256:abc")).toBe(true);
  });

  it("should not match different fingerprints", () => {
    expect(fingerprintsMatch("sha256:abc", "sha256:def")).toBe(false);
  });
});

describe("groupByFingerprint", () => {
  it("should group items by fingerprint", () => {
    const items = [
      { fingerprint: "a", value: 1 },
      { fingerprint: "b", value: 2 },
      { fingerprint: "a", value: 3 },
    ];

    const groups = groupByFingerprint(items);
    expect(groups.size).toBe(2);
    expect(groups.get("a")).toHaveLength(2);
    expect(groups.get("b")).toHaveLength(1);
  });
});

describe("deduplicateFindings", () => {
  it("should keep first occurrence of each fingerprint", () => {
    const items = [
      { fingerprint: "a", value: 1 },
      { fingerprint: "b", value: 2 },
      { fingerprint: "a", value: 3 },
    ];

    const unique = deduplicateFindings(items);
    expect(unique).toHaveLength(2);
    expect(unique[0].value).toBe(1);
    expect(unique[1].value).toBe(2);
  });
});
