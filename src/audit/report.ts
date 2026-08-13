/**
 * Audit report renderer (design §6)
 *
 * One markdown render, sink-agnostic: the local file sink and the GitHub
 * issue sink both publish exactly this string. Deterministic for a given
 * run result — no wall-clock, no floats in the body (integers and
 * percentages only; raw numbers live in the machine artifact).
 */

import type { AuditRunResult } from "./index.js";
import { findingSlug } from "./evidence.js";
import { pathOf } from "./ledger.js";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Files firing on exactly one lane — corroboration never got a chance. */
function singleLaneFirings(result: AuditRunResult): number {
  return result.fileScores.filter((f) => f.firingLanes.length === 1).length;
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

  if (result.coverageGaps.length > 0) {
    const blocked = singleLaneFirings(result);
    lines.push(
      "",
      `> ⚠ **Coverage warning** — ${result.coverageGaps.length} of ${result.lanesPlanned.length} planned lanes unavailable or degraded this run:`,
      ...result.coverageGaps.map((g) => `> - ${g.lane}: ${g.note}`),
      `> The ≥2-lane corroboration gate cannot be evaluated at full strength. An empty offender list below is a coverage statement, not a health claim.` +
        (blocked > 0
          ? ` ${plural(blocked, "file")} fired on a single lane and could not be corroborated.`
          : ""),
    );
  }

  for (const [lane, rate] of Object.entries(result.saturatedLanes)) {
    const laneFact =
      lane === "arrival"
        ? "essentially nothing in this repo moves together with a test"
        : `the whole repo shares this condition`;
    lines.push(
      "",
      `> 🔇 **Lane saturation** — ${lane} fires on ${Math.round(rate * 100)}% of applicable files: ${laneFact}. ` +
        `That is a repo-level fact, said once here; the lane is muted as per-file corroboration until it discriminates.`,
    );
  }

  // Structure drift: cross-directory clone concentration is a repo-level
  // fact (one dir reads as a drifted copy of another), said once here —
  // never a per-file finding, never a style opinion.
  for (const pair of (result.lanes.duplication?.dirPairs ?? []).slice(0, 3)) {
    lines.push(
      "",
      `> 🧭 **Structure drift** — \`${pair.dirA}/\` ↔ \`${pair.dirB}/\` share ${pair.lines} duplicated lines across ${plural(pair.blocks, "clone block")} (${plural(pair.filePairs, "file pair")}): one reads as a drifted copy of the other. Reconcile the pair — per-file fixes will not close this.`,
    );
  }

  lines.push(
    "",
    `Current stock: ${plural(entry.aggregates.offenders, "worst offender")}, ` +
      `${entry.aggregates.gatePassing} gate-passing, ` +
      `${entry.aggregates.candidateFiles} candidate files.` +
      (result.coverageGaps.length > 0
        ? " _(reduced lane coverage this run — see warning above)_"
        : "") +
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
  const dead = result.lanes.deadcode?.entries.find((e) => e.path === path);
  if (dead && dead.score > 0) {
    // knip counts exported names; the definition counter counts export
    // statements — one `export { a, b, c }` line is 1 vs 3. Show the
    // ratio only when it parses as one.
    const ratioMakesSense =
      dead.definitionCount >= dead.deadItems && dead.definitionCount > 0;
    parts.push(
      dead.unusedFile
        ? "entire file unreferenced (knip)"
        : ratioMakesSense
          ? `${dead.deadItems} of ${plural(dead.definitionCount, "exported item")} unconsumed`
          : `${plural(dead.deadItems, "exported item")} unconsumed`,
    );
  }
  const dup = result.lanes.duplication?.entries.find((e) => e.path === path);
  if (dup && dup.duplicatedLines > 0) {
    parts.push(
      dup.clusterFanOut === 0
        ? `${dup.duplicatedLines} lines of internal duplication (repeated blocks within the file)`
        : `${dup.duplicatedLines} duplicated lines across ${plural(dup.clusterFanOut, "partner file")}`,
    );
  }
  const smell = result.lanes.smells?.entries.find((e) => e.path === path);
  if (smell && smell.anyCount > 0 && smell.score >= 0.5) {
    parts.push(`${plural(smell.anyCount, "any-typed identifier")}`);
  }
  const cons = result.lanes.consistency?.entries.find((e) => e.path === path);
  if (cons) {
    if (cons.copyArtifactOf) parts.push(`copy artifact of \`${cons.copyArtifactOf}\``);
    if (cons.orphan) parts.push("orphaned — nothing imports it");
    if (cons.minorityOf) parts.push(`minority provider (${cons.minorityOf})`);
    if (cons.cycleSize) parts.push(`in a ${cons.cycleSize}-file import cycle`);
  }
  // Partial-fix acknowledgment: work on this file is registering even
  // though the finding still fires.
  for (const [fingerprint, pct] of Object.entries(result.ledger.improving)) {
    if (pathOf(fingerprint) === path) {
      const lane = fingerprint.slice(0, fingerprint.indexOf(":"));
      parts.push(`**improving** — ${lane} score down ${pct}% since first flagged`);
    }
  }
  return parts.join("; ");
}

function offendersSection(result: AuditRunResult): string[] {
  const lines: string[] = ["## Worst offenders"];
  if (result.worstOffenders.length === 0) {
    if (result.coverageGaps.length > 0) {
      const blocked = singleLaneFirings(result);
      lines.push(
        "",
        `Not evaluable at full strength — ${result.coverageGaps.length} of ${result.lanesPlanned.length} planned lanes unavailable or degraded (see Health). ` +
          (blocked > 0
            ? `${plural(blocked, "single-lane firing")} could not seek corroboration; they ship as single-lane findings, not as health.`
            : "No lane fired on any file, but that is with reduced coverage."),
      );
    } else {
      lines.push(
        "",
        "None. No file passes the ≥2-applicable-lanes gate and the entry threshold.",
      );
    }
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
        `\n   ${evidenceFor(result, offender.path)}` +
        `\n   Full evidence package: \`.vibecompact/findings/${findingSlug(offender.path)}.md\``,
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
          `firing: ${entry.aggregates.perLane.size?.filesFlagged ?? 0}. ` +
          `Tiers: ${tiers[0]} investigate / ${tiers[1]} heavily scrutinized / ${tiers[2]} no justification.`,
      );
      for (const note of size.notes) lines.push(`- ${note}`);
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
          `firing: ${entry.aggregates.perLane.arrival?.filesFlagged ?? 0}.` +
          (arrival.bulkMuted ? " Bulk arrival is muted." : ""),
      );
      lines.push("", "Confidence basis:");
      for (const note of arrival.disclosures) {
        lines.push(`- ${note}`);
      }
    }
  }

  const deadcode = result.lanes.deadcode;
  if (deadcode) {
    lines.push("", "### Dead code (L1)");
    if (!deadcode.available) {
      lines.push("", `_${deadcode.disclosures.join("; ")}_`);
    } else {
      const flagged = deadcode.entries.filter((e) => e.score > 0);
      const wholeFiles = deadcode.entries.filter((e) => e.unusedFile);
      lines.push(
        "",
        `${plural(deadcode.entries.length, "file")} assessed (${deadcode.coverage.join(", ")}); ` +
          `${flagged.length} carry dead-surface findings, ` +
          `${wholeFiles.length} flagged entirely unreferenced. ` +
          `Firing: ${entry.aggregates.perLane.deadcode?.filesFlagged ?? 0}. Alarm-only — nothing is deleted on your behalf.`,
      );
      for (const note of deadcode.disclosures) lines.push(`- ${note}`);
    }
  }

  const duplication = result.lanes.duplication;
  if (duplication) {
    lines.push("", "### Duplication (L2)");
    if (!duplication.available) {
      lines.push("", `_${duplication.disclosure}_`);
    } else {
      const dupLines = duplication.entries.reduce(
        (sum, e) => sum + e.duplicatedLines,
        0,
      );
      lines.push(
        "",
        `${plural(duplication.entries.length, "file")} carry clones (${dupLines} duplicated lines repo-wide, ` +
          `min block ${result.config.lanes.duplication.minLines} lines). ` +
          `Firing: ${entry.aggregates.perLane.duplication?.filesFlagged ?? 0}.`,
      );
    }
  }

  const smells = result.lanes.smells;
  if (smells) {
    lines.push("", "### Structural smells (L6)");
    if (!smells.available) {
      lines.push("", `_${smells.disclosures.join("; ")}_`);
    } else {
      lines.push(
        "",
        `Repo is ${smells.typedPercent}% typed (type-coverage). ` +
          `Firing: ${entry.aggregates.perLane.smells?.filesFlagged ?? 0} (low-weighted lane).`,
      );
      for (const note of smells.disclosures) lines.push(`- ${note}`);
    }
  }

  const consistency = result.lanes.consistency;
  if (consistency) {
    lines.push("", "### Consistency & redundant infrastructure (L7)");
    const flagged = consistency.entries.filter((e) => e.score > 0);
    lines.push(
      "",
      `${flagged.length} of ${plural(consistency.entries.length, "file")} carry consistency findings. ` +
        `Firing: ${entry.aggregates.perLane.consistency?.filesFlagged ?? 0}.`,
    );
    if (consistency.categoryFindings.length > 0) {
      lines.push("", "Multiple providers of one concern (context, per package):");
      for (const finding of consistency.categoryFindings) {
        const providers = Object.entries(finding.providers)
          .map(([name, count]) => `${name} (${count} import sites)`)
          .join(", ");
        lines.push(
          `- ${finding.category}${finding.packageDir ? ` in \`${finding.packageDir}\`` : ""}: ${providers}`,
        );
      }
    }
    for (const note of consistency.disclosures) lines.push(`- ${note}`);
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
    "# vibeCompact",
    "",
    `Anchor: \`${result.anchorSha?.slice(0, 12) ?? "no git"}\` (${result.trends.entry.at.slice(0, 10)})` +
      (result.dirty ? " · dirty working tree" : ""),
  ];

  const appendix = [
    "## Appendix",
    "",
    `- Excluded as generated/vendored: ${plural(result.excluded.length, "file")}.`,
    `- JS/TS project roots (knip/type-coverage cwd): ${result.jsRoots.length > 0 ? result.jsRoots.map((r) => `\`${r}\``).join(", ") : "none found"}.`,
    `- Declared entry points detected (exempt from orphan/dead-surface claims): ${result.entryPointCount}.`,
    `- Lanes planned: ${result.lanesPlanned.join(", ") || "none"}.`,
    `- Machine-readable results: \`.vibecompact/out/audit.json\`.`,
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

/**
 * Trimmed machine payload for .vibecompact/out/audit.json — no history dump.
 * Every lane the summary quotes counts for must ship its entries here:
 * signal-bearing entries in full, zero-signal ones as an assessed count
 * (pygmalion beta finding 3 — counts without evidence are unactionable).
 */
export function buildMachineResult(result: AuditRunResult): object {
  const deadcode = result.lanes.deadcode;
  const duplication = result.lanes.duplication;
  const smells = result.lanes.smells;
  const consistency = result.lanes.consistency;
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
      deadcode: deadcode
        ? {
            available: deadcode.available,
            disclosures: deadcode.disclosures,
            filesSignalMuted: deadcode.filesSignalMuted,
            coverage: deadcode.coverage,
            assessedCount: deadcode.entries.length,
            entries: deadcode.entries.filter(
              (e) => e.score > 0 || e.unusedFile || e.deadItems > 0,
            ),
          }
        : undefined,
      duplication: duplication
        ? {
            available: duplication.available,
            disclosure: duplication.disclosure,
            dirPairs: duplication.dirPairs,
            entries: duplication.entries,
          }
        : undefined,
      smells: smells
        ? {
            available: smells.available,
            disclosures: smells.disclosures,
            typedPercent: smells.typedPercent,
            assessedCount: smells.entries.length,
            entries: smells.entries.filter((e) => e.anyCount > 0),
          }
        : undefined,
      consistency: consistency
        ? {
            available: true,
            disclosures: consistency.disclosures,
            categoryFindings: consistency.categoryFindings,
            assessedCount: consistency.entries.length,
            entries: consistency.entries.filter((e) => e.score > 0),
          }
        : undefined,
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
