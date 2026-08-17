/**
 * Audit configuration
 *
 * Resolves the `audit:` config block (design §8) against defaults. All audit
 * code reads the resolved shape — raw user config never travels past here.
 */

import type { AuditConfig } from "../core/types.js";

export interface ResolvedLaneConfig {
  enabled: boolean;
}

export interface ResolvedDuplicationLaneConfig extends ResolvedLaneConfig {
  minLines: number;
}

export interface ResolvedAuditConfig {
  enabled: boolean;
  dynamicTests: boolean;
  reportChannel: "issue" | "pr";
  maxReportItems: number;
  /** Ascending code-line boundaries for size tiers 1/2/3. */
  sizeTiers: [number, number, number];
  /** Extra excluded path prefixes, normalized without trailing slash. */
  exclude: string[];
  /** JS/TS project roots for knip/type-coverage; [] = auto-discover. */
  jsRoots: string[];
  /** Findings-PR lifecycle: "episodic" opens a batch PR only when new
   * findings fired since the last acknowledged (closed) one; "never"
   * delivers via the data branch and living issue only. */
  dataPr: "episodic" | "never";
  lanes: {
    size: ResolvedLaneConfig;
    arrival: ResolvedLaneConfig;
    deadcode: ResolvedLaneConfig;
    duplication: ResolvedDuplicationLaneConfig;
    smells: ResolvedLaneConfig;
    consistency: ResolvedLaneConfig;
  };
}

export const DEFAULT_AUDIT_CONFIG: ResolvedAuditConfig = {
  enabled: true,
  dynamicTests: false,
  reportChannel: "issue",
  maxReportItems: 15,
  sizeTiers: [500, 1000, 2000],
  exclude: [],
  jsRoots: [],
  dataPr: "episodic",
  lanes: {
    size: { enabled: true },
    arrival: { enabled: true },
    deadcode: { enabled: true },
    duplication: { enabled: true, minLines: 30 },
    smells: { enabled: true },
    consistency: { enabled: true },
  },
};

function resolveSizeTiers(
  tiers: number[] | undefined,
): [number, number, number] {
  if (!tiers) return DEFAULT_AUDIT_CONFIG.sizeTiers;
  if (
    tiers.length !== 3 ||
    tiers.some((t) => !Number.isFinite(t) || t <= 0) ||
    !(tiers[0] < tiers[1] && tiers[1] < tiers[2])
  ) {
    console.warn(
      `Invalid audit.size_tiers ${JSON.stringify(tiers)} — expected 3 ascending positive numbers; using defaults`,
    );
    return DEFAULT_AUDIT_CONFIG.sizeTiers;
  }
  return [tiers[0], tiers[1], tiers[2]];
}

export function resolveAuditConfig(raw?: AuditConfig): ResolvedAuditConfig {
  const d = DEFAULT_AUDIT_CONFIG;
  return {
    enabled: raw?.enabled ?? d.enabled,
    dynamicTests: raw?.dynamic_tests ?? d.dynamicTests,
    reportChannel: raw?.report_channel ?? d.reportChannel,
    maxReportItems: raw?.max_report_items ?? d.maxReportItems,
    sizeTiers: resolveSizeTiers(raw?.size_tiers),
    exclude: (raw?.exclude ?? []).map((p) =>
      p.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, ""),
    ),
    jsRoots: (raw?.js_roots ?? []).map((p) =>
      p.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, ""),
    ),
    dataPr: raw?.data_pr === "never" ? "never" : d.dataPr,
    lanes: {
      size: { enabled: raw?.lanes?.size?.enabled ?? d.lanes.size.enabled },
      arrival: {
        enabled: raw?.lanes?.arrival?.enabled ?? d.lanes.arrival.enabled,
      },
      deadcode: {
        enabled: raw?.lanes?.deadcode?.enabled ?? d.lanes.deadcode.enabled,
      },
      duplication: {
        enabled:
          raw?.lanes?.duplication?.enabled ?? d.lanes.duplication.enabled,
        minLines:
          raw?.lanes?.duplication?.min_lines ?? d.lanes.duplication.minLines,
      },
      smells: {
        enabled: raw?.lanes?.smells?.enabled ?? d.lanes.smells.enabled,
      },
      consistency: {
        enabled:
          raw?.lanes?.consistency?.enabled ?? d.lanes.consistency.enabled,
      },
    },
  };
}
