/**
 * Audit report renderer (design §6)
 *
 * One markdown render, sink-agnostic: the local file sink and the GitHub
 * issue sink both publish exactly this string. Deterministic for a given
 * run result — no wall-clock, no floats in the body (integers and
 * percentages only; raw numbers live in the machine artifact).
 */

import type { AuditRunResult } from "./index.js";
import { pathOf } from "./ledger.js";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function healthSection(result: AuditRunResult): string[] {
  const lines: string[] = ["## Health"];
  const { derivative, entry } = result.trends;

  if (derivative) {
    const deltas: string[] = [];
    const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    deltas.push(`${sign(derivative.offendersDelta)} worst offenders`);
    for (const [lane, delta] of Object.entries(derivative.firingDelta)) {
      if (delta !== 0) deltas.push(`${lane} firing ${sign(delta)}`);
    }
    lines.push(
      "",
      `Since ${derivative.baselineAt.slice(0, 10)} (${derivative.spanDays} days): ` +
        (deltas.length > 0 ? deltas.join(", ") : "no change") +
        ".",
    );
    if (derivative.suppressedByFloorExcluded > 0) {
      lines.push(
        `${plural(derivative.suppressedByFloorExcluded, "finding")} newly suppressed by raised floors — not counted as improvement.`,
      );
    }
    for (const brk of derivative.trendBreaks) {
      lines.push(`> ⚠ Trend break — ${brk}. Deltas across this change are not comparable.`);
    }
  } else {
    lines.push(
      "",
      "No trend baseline yet — the derivative needs a clean run at least 21 days old.",
    );
  }

  lines.push(
    "",
    `Current stock: ${plural(entry.aggregates.offenders, "worst offender")}, ` +
      `${entry.aggregates.gatePassing} gate-passing, ` +
      `${entry.aggregates.candidateFiles} candidate files.` +
      (entry.dirty ? " _(dirty working tree — excluded from trend baselines)_" : ""),
  );
  return lines;
}

function evidenceFor(result: AuditRunResult, path: string): string {
  const parts: string[] = [];
  const size = result.lanes.size?.entries.find((e) => e.path === path);
  if (size) {
    parts.push(
      `${size.codeLines} code lines` +
        (size.tier > 0 ? ` (tier ${size.tier})` : ""),
    );
  }
  const arrival = result.lanes.arrival?.entries.find((e) => e.path === path);
  if (arrival && arrival.applicable) {
    parts.push(
      `${pct(arrival.untestedShare)} of ${plural(arrival.touches, "commit")} arrived with no reaching test` +
        (arrival.coChangeMode === "commit" ? " (commit-granularity)" : ""),
    );
    if (arrival.bulkScore >= 5) {
      parts.push(
        `largest single-commit arrival ${Math.round(arrival.bulkScore)}× the repo's median commit`,
      );
    }
    if (arrival.snapshotChurnShare > 0) {
      parts.push(`snapshot churn in ${pct(arrival.snapshotChurnShare)} of touches`);
    }
  }
  return parts.join("; ");
}

function offendersSection(result: AuditRunResult): string[] {
  const lines: string[] = ["## Worst offenders"];
  if (result.worstOffenders.length === 0) {
    lines.push(
      "",
      "None. No file passes the ≥2-applicable-lanes gate and the entry threshold.",
    );
    return lines;
  }
  lines.push(
    "",
    `Entry requires ≥2 applicable lanes firing plus margin; ${result.config.maxReportItems} is a ceiling, not a quota.`,
    "",
  );
  for (const [rank, offender] of result.worstOffenders.entries()) {
    lines.push(
      `${rank + 1}. \`${offender.path}\` — firing: ` +
        offender.firingLanes.map((f) => f.lane).join(" + ") +
        ` (${offender.applicableLanes.length} lanes applicable)` +
        `\n   ${evidenceFor(result, offender.path)}`,
    );
  }
  return lines;
}

function targetsSection(result: AuditRunResult): string[] {
  const lines: string[] = ["## Best first targets"];
  if (result.bestFirstTargets.length === 0) {
    lines.push("", "None — nothing gate-passing to start on.");
    return lines;
  }
  lines.push(
    "",
    "Gate-passing files with the smallest blast radius — real findings a maintainer can safely start on.",
    "",
  );
  for (const target of result.bestFirstTargets) {
    lines.push(`- \`${target.path}\` — ${evidenceFor(result, target.path)}`);
  }
  return lines;
}

function laneSection(result: AuditRunResult): string[] {
  const lines: string[] = ["## Lane summaries"];
  const entry = result.trends.entry;

  const size = result.lanes.size;
  if (size) {
    lines.push("", "### Size & complexity (L5)");
    if (!size.available) {
      lines.push("", `_${size.disclosure}_`);
    } else {
      const tiers = [1, 2, 3].map(
        (t) => size.entries.filter((e) => e.tier === t).length,
      );
      lines.push(
        "",
        `${plural(size.entries.length, "file")} measured (scc ${size.toolVersion ?? "unknown"}); ` +
          `firing: ${entry.aggregates.perLane.size?.firing ?? 0}. ` +
          `Tiers: ${tiers[0]} investigate / ${tiers[1]} heavily scrutinized / ${tiers[2]} no justification.`,
      );
    }
  }

  const arrival = result.lanes.arrival;
  if (arrival) {
    lines.push("", "### Arrival forensics (L3)");
    if (!arrival.available) {
      lines.push("", `_${arrival.disclosures.join("; ")}_`);
    } else {
      const applicable = arrival.entries.filter((e) => e.applicable);
      lines.push(
        "",
        `${plural(applicable.length, "file")} with enough history to judge; ` +
          `firing: ${entry.aggregates.perLane.arrival?.firing ?? 0}.` +
          (arrival.bulkMuted ? " Bulk arrival is muted." : ""),
      );
      lines.push("", "Confidence basis:");
      for (const note of arrival.disclosures) {
        lines.push(`- ${note}`);
      }
    }
  }

  const languages = new Set(
    (result.lanes.size?.entries ?? []).map((e) => e.language),
  );
  if (languages.size > 1) {
    lines.push(
      "",
      "_Rank caveat: lane coverage differs by language; cross-language ranks are not apples-to-apples._",
    );
  }
  return lines;
}

function ledgerSection(result: AuditRunResult): string[] {
  const lines: string[] = ["## Ledger activity"];
  const { floors, suppressed, agingJustifications, reopened } = result.ledger;

  const floorEntries = Object.entries(floors);
  lines.push(
    "",
    floorEntries.length === 0
      ? "Standing floors: none."
      : "Standing floors (attested ratchet, reversible via `vibecheck floors reset <lane>`): " +
          floorEntries.map(([lane, floor]) => `${lane} at ${floor}`).join(", ") +
          ".",
  );

  if (suppressed.length > 0) {
    const byStatus = new Map<string, number>();
    for (const s of suppressed) {
      byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
    }
    lines.push(
      "",
      "Suppressed by verdicts: " +
        [...byStatus.entries()]
          .sort()
          .map(([status, count]) => `${count} ${status}`)
          .join(", ") +
        ".",
    );
  }

  const suppressedByFloor = result.trends.entry.aggregates.suppressedByFloor;
  if (suppressedByFloor > 0) {
    lines.push(
      "",
      `${plural(suppressedByFloor, "finding")} suppressed by raised floors (never counted as improvement).`,
    );
  }

  if (reopened.length > 0) {
    lines.push("", "Reopened by growth invalidation:");
    for (const fingerprint of reopened) {
      lines.push(`- \`${fingerprint}\``);
    }
  }

  if (agingJustifications.length > 0) {
    lines.push(
      "",
      "Aging justifications — re-affirm with `vibecheck justify <fingerprint> --reason ...`:",
    );
    for (const event of agingJustifications) {
      lines.push(
        `- \`${event.fingerprint}\` (${event.at.slice(0, 10)}): "${event.reason}"`,
      );
    }
  }
  return lines;
}

export function renderAuditReport(result: AuditRunResult): string {
  const header = [
    "# vibeCheck Audit",
    "",
    `Anchor: \`${result.anchorSha?.slice(0, 12) ?? "no git"}\` (${result.trends.entry.at.slice(0, 10)})` +
      (result.dirty ? " · dirty working tree" : ""),
  ];

  const appendix = [
    "## Appendix",
    "",
    `- Excluded as generated/vendored: ${plural(result.excluded.length, "file")}.`,
    `- Lanes planned: ${result.lanesPlanned.join(", ") || "none"}.`,
    `- Machine-readable results: \`.vibecheck/out/audit.json\`.`,
    `- File verdicts: \`vibecheck justify|wontfix|noise <lane>:<path> --reason "..."\`.`,
  ];

  const sections = [
    header,
    healthSection(result),
    offendersSection(result),
    targetsSection(result),
    laneSection(result),
    ledgerSection(result),
    appendix,
  ];
  return sections.map((s) => s.join("\n")).join("\n\n") + "\n";
}

/** Trimmed machine payload for .vibecheck/out/audit.json — no history dump. */
export function buildMachineResult(result: AuditRunResult): object {
  return {
    anchorSha: result.anchorSha,
    anchorDate: result.trends.entry.at,
    dirty: result.dirty,
    config: result.config,
    candidateFiles: result.candidateFiles.length,
    excluded: result.excluded,
    lanes: {
      size: result.lanes.size
        ? {
            available: result.lanes.size.available,
            toolVersion: result.lanes.size.toolVersion,
            disclosure: result.lanes.size.disclosure,
            entries: result.lanes.size.entries,
          }
        : undefined,
      arrival: result.lanes.arrival,
    },
    fileScores: result.fileScores,
    worstOffenders: result.worstOffenders.map((o) => o.path),
    bestFirstTargets: result.bestFirstTargets.map((t) => t.path),
    ledger: {
      ...result.ledger,
      agingJustifications: result.ledger.agingJustifications.map((e) => ({
        fingerprint: e.fingerprint,
        at: e.at,
        reason: e.reason,
        path: pathOf(e.fingerprint),
      })),
    },
    trends: result.trends,
  };
}
