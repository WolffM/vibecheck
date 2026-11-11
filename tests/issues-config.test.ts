import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveIssuesConfig, type VibeCopConfig } from "../src/core/types.js";

describe("resolveIssuesConfig", () => {
  it("uses defaults when issues config is missing", () => {
    const config: VibeCopConfig = { version: 1 };
    expect(resolveIssuesConfig(config)).toEqual(DEFAULT_CONFIG.issues);
  });

  it("overrides only specified values", () => {
    const config: VibeCopConfig = {
      version: 1,
      issues: {
        enabled: false,
        label: "custom",
        max_new_per_run: 3,
        severity_threshold: "high",
        confidence_threshold: "medium",
        close_resolved: false,
      },
    };

    const resolved = resolveIssuesConfig(config);
    expect(resolved.enabled).toBe(false);
    expect(resolved.label).toBe("custom");
    expect(resolved.max_new_per_run).toBe(3);
    expect(resolved.severity_threshold).toBe("high");
    expect(resolved.confidence_threshold).toBe("medium");
    expect(resolved.close_resolved).toBe(false);
    expect(resolved.assignees).toEqual([]);
  });
});
