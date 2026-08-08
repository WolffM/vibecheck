/**
 * Per-finding packages (round 3 delivery redesign)
 *
 * One markdown file per active finding under `.vibecompact/findings/`,
 * shipped with the data-file commit so every problem carries its full
 * context in-repo: exact dead symbols with lines, exact clone ranges and
 * partners, pre-run string-reference verification, and a symbol map with
 * candidate cut points. The bar: an agent should be able to act without
 * re-running the investigation.
 *
 * The directory is regenerated every run — fixed or suppressed findings'
 * packages disappear with them.
 */

import {
  extractSymbolMap,
  findingSlug,
  largestSymbols,
  stringReferenceScan,
  type StringReference,
} from "./evidence.js";
import type { AuditRunResult } from "./index.js";
import { deletionCandidates } from "./briefing.js";
import type { FileScore } from "./scoring.js";

function verificationSection(
  path: string,
  refs: StringReference[] | undefined,
): string[] {
  if (refs === undefined) return [];
  if (refs.length === 0) {
    return [
      "",
      "### Pre-run verification",
      "",
      `String-reference scan: **clean** — no other tracked file mentions \`${path.slice(path.lastIndexOf("/") + 1)}\`'s stem. ` +
        "Remaining risk is out-of-repo consumers (deploy scripts, external repos).",
    ];
  }
  return [
    "",
    "### Pre-run verification",
    "",
    "String-reference scan found mentions — **inspect these before treating the file as unreachable** (they usually name the loading mechanism):",
    "",
    ...refs.map((r) => `- \`${r.file}:${r.line}\` — \`${r.text}\``),
  ];
}

function laneDetail(
  result: AuditRunResult,
  path: string,
  lane: string,
): string[] {
  const lines: string[] = [];
  switch (lane) {
    case "size": {
      const entry = result.lanes.size?.entries.find((e) => e.path === path);
      if (!entry) break;
      lines.push(
        "",
        `### size — ${entry.codeLines} code lines (tier ${entry.tier})`,
      );
      const symbols = largestSymbols(
        extractSymbolMap(result.rootPath, path),
      );
      if (symbols.length > 0) {
        lines.push(
          "",
          "Largest top-level symbols — the natural cut points:",
          "",
          "| symbol | kind | lines | span |",
          "|---|---|---|---|",
          ...symbols.map(
            (s) =>
              `| \`${s.name}\` | ${s.kind} | ${s.lines} | ${s.start}–${s.end} |`,
          ),
          "",
          `Suggested first cut: extract \`${symbols[0].name}\` (${symbols[0].lines} lines) into its own module, with a test first.`,
        );
      }
      break;
    }
    case "deadcode": {
      const entry = result.lanes.deadcode?.entries.find((e) => e.path === path);
      if (!entry) break;
      lines.push(
        "",
        entry.unusedFile
          ? "### deadcode — entire file unreferenced (knip)"
          : `### deadcode — ${entry.deadItems} of ${entry.definitionCount} exported items unconsumed`,
      );
      if (entry.deadDetail.length > 0) {
        lines.push(
          "",
          "| item | line |",
          "|---|---|",
          ...entry.deadDetail
            .slice(0, 20)
            .map((d) => `| \`${d.name}\` | ${d.line || "?"} |`),
        );
        if (entry.deadDetail.length > 20) {
          lines.push(`| …${entry.deadDetail.length - 20} more | |`);
        }
      }
      break;
    }
    case "duplication": {
      const entry = result.lanes.duplication?.entries.find(
        (e) => e.path === path,
      );
      if (!entry) break;
      lines.push(
        "",
        `### duplication — ${entry.duplicatedLines} duplicated lines`,
        "",
        "| this file | duplicates |",
        "|---|---|",
        ...entry.clones.map((c) =>
          c.partner === ""
            ? `| ${c.start}–${c.end} | ${c.partnerStart}–${c.partnerEnd} (same file) |`
            : `| ${c.start}–${c.end} | \`${c.partner}\`:${c.partnerStart}–${c.partnerEnd} |`,
        ),
        "",
        "Extract the shared block into one module both sites import.",
      );
      break;
    }
    case "arrival": {
      const entry = result.lanes.arrival?.entries.find((e) => e.path === path);
      if (!entry) break;
      lines.push(
        "",
        `### arrival — ${Math.round(entry.untestedShare * 100)}% of ${entry.touches} commits arrived with no reaching test` +
          (entry.bulkScore >= 5
            ? `; largest single-commit arrival ${Math.round(entry.bulkScore)}× the repo median`
            : ""),
        "",
        "Before further changes: add one test whose static import path reaches this file.",
      );
      break;
    }
    case "smells": {
      const entry = result.lanes.smells?.entries.find((e) => e.path === path);
      if (!entry) break;
      lines.push(
        "",
        `### smells — ${entry.anyCount} any-typed identifiers (run \`npx type-coverage --detail\` for positions)`,
      );
      break;
    }
    case "consistency": {
      const entry = result.lanes.consistency?.entries.find(
        (e) => e.path === path,
      );
      if (!entry) break;
      const bits: string[] = [];
      if (entry.copyArtifactOf)
        bits.push(`copy artifact of \`${entry.copyArtifactOf}\``);
      if (entry.orphan) bits.push("orphaned (zero import fan-in)");
      if (entry.minorityOf) bits.push(`minority provider: ${entry.minorityOf}`);
      if (entry.cycleSize) bits.push(`member of a ${entry.cycleSize}-file import cycle`);
      lines.push("", `### consistency — ${bits.join("; ")}`);
      break;
    }
  }
  return lines;
}

function offenderPackage(
  result: AuditRunResult,
  offender: FileScore,
  rank: number | null,
  refs: Map<string, StringReference[]>,
): string {
  const standing =
    rank !== null
      ? `Corroborated finding, rank ${rank}`
      : "Single-lane finding (below the corroboration gate — one signal, weigh accordingly)";
  const lines = [
    `# ${offender.path}`,
    "",
    `${standing} · firing: ${offender.firingLanes.map((f) => f.lane).join(" + ")} · ${offender.applicableLanes.length} lanes applicable · anchor \`${result.anchorSha?.slice(0, 12)}\``,
  ];
  for (const firing of offender.firingLanes) {
    lines.push(...laneDetail(result, offender.path, firing.lane));
  }
  const consistency = result.lanes.consistency?.entries.find(
    (e) => e.path === offender.path,
  );
  if (consistency?.orphan) {
    lines.push(...verificationSection(offender.path, refs.get(offender.path)));
  }
  lines.push(
    "",
    "### If this finding is wrong or accepted",
    "",
    "```",
    ...offender.firingLanes.map(
      (f) =>
        `vibecheck wontfix|noise|justify "${f.lane}:${offender.path}" --reason "..."`,
    ),
    "```",
  );
  return lines.join("\n") + "\n";
}

function deletionPackage(
  result: AuditRunResult,
  path: string,
  reason: string,
  refs: Map<string, StringReference[]>,
): string {
  const dead = result.lanes.deadcode?.entries.find((e) => e.path === path);
  const lines = [
    `# ${path}`,
    "",
    `Deletion candidate · ${reason} · anchor \`${result.anchorSha?.slice(0, 12)}\``,
  ];
  if (dead && dead.deadDetail.length > 0) {
    lines.push(...laneDetail(result, path, "deadcode"));
  }
  lines.push(...verificationSection(path, refs.get(path)));
  lines.push(
    "",
    "### Action",
    "",
    refs.get(path)?.length === 0
      ? "Delete the file; CI plus one manual smoke of any runtime loaders is the remaining check."
      : "Resolve the references above first; if they are the loading mechanism, file a noise verdict instead:",
    "",
    "```",
    `vibecheck noise "consistency:${path}" --reason "..."`,
    "```",
  );
  return lines.join("\n") + "\n";
}

/** filename (without dir) → package content. */
export function renderFindingPackages(
  result: AuditRunResult,
): Map<string, string> {
  const packages = new Map<string, string>();
  const deletions = deletionCandidates(result);
  const scanTargets = [
    ...new Set([
      ...deletions.map((d) => d.path),
      ...result.worstOffenders
        .filter((o) =>
          result.lanes.consistency?.entries.some(
            (e) => e.path === o.path && e.orphan,
          ),
        )
        .map((o) => o.path),
    ]),
  ];
  const refs = stringReferenceScan(
    result.rootPath,
    result.candidateFiles,
    scanTargets,
  );

  for (const [index, offender] of result.worstOffenders.entries()) {
    packages.set(
      `${findingSlug(offender.path)}.md`,
      offenderPackage(result, offender, index + 1, refs),
    );
  }

  // Single-lane firing findings get packages too (round 5): the gate
  // governs the corroborated headline, not what evidence ships — a file
  // with exact clone ranges is actionable regardless of corroboration.
  // Capped per lane by score to keep the set readable.
  const capPerLane = result.config.maxReportItems;
  const perLaneCount = new Map<string, number>();
  const singles = result.fileScores
    .filter(
      (f) =>
        f.firingLanes.length >= 1 &&
        !result.worstOffenders.some((o) => o.path === f.path),
    )
    .sort(
      (a, b) =>
        b.weightedScore - a.weightedScore ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
  for (const single of singles) {
    const lane = single.firingLanes[0]?.lane ?? "";
    const count = perLaneCount.get(lane) ?? 0;
    if (count >= capPerLane) continue;
    perLaneCount.set(lane, count + 1);
    packages.set(
      `${findingSlug(single.path)}.md`,
      offenderPackage(result, single, null, refs),
    );
  }
  for (const deletion of deletions) {
    const name = `DELETE__${findingSlug(deletion.path)}.md`;
    if (![...packages.keys()].includes(name)) {
      packages.set(
        name,
        deletionPackage(result, deletion.path, deletion.reason, refs),
      );
    }
  }
  return packages;
}
