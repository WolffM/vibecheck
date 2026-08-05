import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIT_CONFIG,
  resolveAuditConfig,
} from "../src/audit/config.js";

describe("resolveAuditConfig", () => {
  it("returns full defaults when no audit block is present", () => {
    expect(resolveAuditConfig(undefined)).toEqual(DEFAULT_AUDIT_CONFIG);
    expect(resolveAuditConfig({})).toEqual(DEFAULT_AUDIT_CONFIG);
  });

  it("applies partial overrides without disturbing other defaults", () => {
    const resolved = resolveAuditConfig({
      report_channel: "pr",
      max_report_items: 5,
      lanes: { duplication: { min_lines: 50 } },
    });
    expect(resolved.reportChannel).toBe("pr");
    expect(resolved.maxReportItems).toBe(5);
    expect(resolved.lanes.duplication.minLines).toBe(50);
    expect(resolved.lanes.duplication.enabled).toBe(true);
    expect(resolved.sizeTiers).toEqual([500, 1000, 2000]);
    expect(resolved.enabled).toBe(true);
  });

  it("accepts valid custom size tiers", () => {
    const resolved = resolveAuditConfig({ size_tiers: [300, 600, 1200] });
    expect(resolved.sizeTiers).toEqual([300, 600, 1200]);
  });

  it("falls back to default size tiers on invalid input", () => {
    for (const bad of [[500], [500, 400, 2000], [0, 1000, 2000], [500, 500, 2000]]) {
      expect(resolveAuditConfig({ size_tiers: bad }).sizeTiers).toEqual([
        500, 1000, 2000,
      ]);
    }
  });

  it("allows disabling individual lanes", () => {
    const resolved = resolveAuditConfig({
      lanes: { arrival: { enabled: false } },
    });
    expect(resolved.lanes.arrival.enabled).toBe(false);
    expect(resolved.lanes.size.enabled).toBe(true);
  });
});
