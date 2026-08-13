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
  extractNestedSymbols,
  extractSymbolMap,
  findingSlug,
  largestSymbols,
  stringReferenceScan,
  type StringReference,
} from "./evidence.js";
import type { AuditRunResult } from "./index.js";
import { deletionCandidates } from "./briefing.js";
import { laneOf, pathOf, type VerdictEvent } from "./ledger.js";
import type { FileScore } from "./scoring.js";

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Standing verdicts on the same lane for sibling files (same directory).
 * A pattern the maintainer has already adjudicated five times should be
 * quoted, not rediscovered — the noise ratchet exists precisely so the
 * sixth identical case doesn't cost another investigation (round-7: pm2
 * wrappers and template scaffolding re-fired past their precedents).
 */
export function siblingPrecedents(
  result: AuditRunResult,
  path: string,
  lane: string,
): VerdictEvent[] {
  const dir = parentDir(path);
  return result.ledger.verdicts
    .filter(
      (v) =>
        laneOf(v.fingerprint) === lane &&
        pathOf(v.fingerprint) !== path &&
        parentDir(pathOf(v.fingerprint)) === dir,
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

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
        `### size — ${entry.codeLines} code lines (tier ${entry.tier})` +
          (entry.rawCodeLines !== undefined
            ? ` · ${entry.rawCodeLines} raw scc lines (docstrings excluded from the tiered count)`
            : ""),
      );
      const fullMap = extractSymbolMap(result.rootPath, path);
      const symbols = largestSymbols(fullMap);
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
        );
        // A symbol that IS most of the file makes "extract it" a no-op —
        // the new module would be as big as the problem. The useful cut
        // is inside it (pygmalion beta finding 6).
        const fileLines = fullMap[fullMap.length - 1].end;
        const dominant =
          fileLines > 0 && symbols[0].lines / fileLines >= 0.6;
        if (dominant) {
          const inner = extractNestedSymbols(result.rootPath, path, symbols[0]);
          lines.push(
            "",
            `\`${symbols[0].name}\` alone is ${Math.round((symbols[0].lines / fileLines) * 100)}% of the file — moving it to its own module would relocate the problem, not reduce it. Cut inside it instead:`,
          );
          if (inner.length >= 2) {
            const top = [...inner].sort((a, b) => b.lines - a.lines).slice(0, 8);
            lines.push(
              "",
              `| section inside \`${symbols[0].name}\` | kind | lines | span |`,
              "|---|---|---|---|",
              ...top.map(
                (s) =>
                  `| \`${s.name}\` | ${s.kind} | ${s.lines} | ${s.start}–${s.end} |`,
              ),
              "",
              `Suggested first cut: group these ${inner.length} inner sections by responsibility and extract one group at a time, with a test first.`,
            );
          } else {
            lines.push(
              "",
              `Suggested first cut: split \`${symbols[0].name}\` at its internal boundaries (blocks, route groups, phases) rather than extracting it whole, with a test first.`,
            );
          }
        } else {
          lines.push(
            "",
            `Suggested first cut: extract \`${symbols[0].name}\` (${symbols[0].lines} lines) into its own module, with a test first.`,
          );
        }
      }
      break;
    }
    case "deadcode": {
      const entry = result.lanes.deadcode?.entries.find((e) => e.path === path);
      if (!entry) break;
      // knip counts exported names; the definition counter counts export
      // statements — show the ratio only when it parses as one (the
      // round-7 "11 of 3 exported items" counter).
      const ratioMakesSense =
        entry.definitionCount >= entry.deadItems && entry.definitionCount > 0;
      lines.push(
        "",
        entry.unusedFile
          ? "### deadcode — entire file unreferenced (knip)"
          : ratioMakesSense
            ? `### deadcode — ${entry.deadItems} of ${entry.definitionCount} exported items unconsumed`
            : `### deadcode — ${entry.deadItems} exported item${entry.deadItems === 1 ? "" : "s"} unconsumed`,
      );
      if (entry.deadDetail.length > 0) {
        const action = (d: { internalUse?: boolean }) =>
          d.internalUse === true
            ? "un-export — used inside this file"
            : d.internalUse === false
              ? "delete after verification"
              : "";
        const hasActions = entry.deadDetail.some(
          (d) => d.internalUse !== undefined,
        );
        lines.push(
          "",
          hasActions ? "| item | line | action |" : "| item | line |",
          hasActions ? "|---|---|---|" : "|---|---|",
          ...entry.deadDetail
            .slice(0, 20)
            .map((d) =>
              hasActions
                ? `| \`${d.name}\` | ${d.line || "?"} | ${action(d)} |`
                : `| \`${d.name}\` | ${d.line || "?"} |`,
            ),
        );
        if (entry.deadDetail.length > 20) {
          const more = entry.deadDetail.length - 20;
          lines.push(hasActions ? `| …${more} more | | |` : `| …${more} more | |`);
        }
        if (entry.deadDetail.some((d) => d.internalUse === true)) {
          lines.push(
            "",
            "Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.",
          );
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

function deletionActionSection(
  path: string,
  refs: Map<string, StringReference[]>,
): string[] {
  return [
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
  ];
}

function offenderPackage(
  result: AuditRunResult,
  offender: FileScore,
  rank: number | null,
  refs: Map<string, StringReference[]>,
  deletionReason?: string,
): string {
  const standing =
    rank !== null
      ? `Corroborated finding, rank ${rank}`
      : "Single-lane finding (below the corroboration gate — one signal, weigh accordingly)";
  const lines = [
    `# ${offender.path}`,
    "",
    `${standing} · firing: ${offender.firingLanes.map((f) => f.lane).join(" + ")} · ${offender.applicableLanes.length} lanes applicable · anchor \`${result.anchorSha?.slice(0, 12)}\`` +
      (deletionReason ? ` · deletion candidate (${deletionReason})` : ""),
  ];
  for (const firing of offender.firingLanes) {
    lines.push(...laneDetail(result, offender.path, firing.lane));
  }
  const consistency = result.lanes.consistency?.entries.find(
    (e) => e.path === offender.path,
  );
  // One package per file: a deletion candidate that also fires as a
  // finding gets its verification + action here, not a duplicate
  // DELETE__ file (round-7: the two copies drifted-by-repetition).
  if (deletionReason || consistency?.orphan) {
    lines.push(...verificationSection(offender.path, refs.get(offender.path)));
  }
  if (deletionReason) {
    lines.push(...deletionActionSection(offender.path, refs));
  }
  const precedents = [
    ...new Map(
      offender.firingLanes
        .flatMap((f) => siblingPrecedents(result, offender.path, f.lane))
        .map((v) => [v.fingerprint, v] as const),
    ).values(),
  ].slice(0, 5);
  if (precedents.length > 0) {
    lines.push(
      "",
      "### Precedent — sibling verdicts in this directory",
      "",
      ...precedents.map(
        (v) =>
          `- \`${v.verdict}\` on \`${v.fingerprint}\` (${v.at.slice(0, 10)}): "${v.reason}"`,
      ),
      "",
      "If this finding matches the same pattern, propose the same verdict instead of re-investigating.",
    );
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
  lines.push(...deletionActionSection(path, refs));
  return lines.join("\n") + "\n";
}

export interface PackagedFindings {
  corroborated: FileScore[];
  /** Single-lane firing files, capped per lane by weighted score. */
  singles: FileScore[];
  /** Firings the per-lane cap cut, lane → count. Never truncate silently
   * (round-7: dropped size firings read as "covered everything"). */
  droppedByLane: Map<string, number>;
}

/** The one selection both the packages and the briefing render from. */
export function selectPackagedFindings(
  result: AuditRunResult,
): PackagedFindings {
  const capPerLane = result.config.maxReportItems;
  const perLaneCount = new Map<string, number>();
  const singles: FileScore[] = [];
  const droppedByLane = new Map<string, number>();
  const candidates = result.fileScores
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
  for (const single of candidates) {
    const lane = single.firingLanes[0]?.lane ?? "";
    const count = perLaneCount.get(lane) ?? 0;
    if (count >= capPerLane) {
      droppedByLane.set(lane, (droppedByLane.get(lane) ?? 0) + 1);
      continue;
    }
    perLaneCount.set(lane, count + 1);
    singles.push(single);
  }
  return { corroborated: [...result.worstOffenders], singles, droppedByLane };
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

  const deletionReasons = new Map(deletions.map((d) => [d.path, d.reason]));
  const packagedPaths = new Set<string>();

  for (const [index, offender] of result.worstOffenders.entries()) {
    packages.set(
      `${findingSlug(offender.path)}.md`,
      offenderPackage(
        result,
        offender,
        index + 1,
        refs,
        deletionReasons.get(offender.path),
      ),
    );
    packagedPaths.add(offender.path);
  }

  // Single-lane firing findings get packages too (round 5): the gate
  // governs the corroborated headline, not what evidence ships — a file
  // with exact clone ranges is actionable regardless of corroboration.
  for (const single of selectPackagedFindings(result).singles) {
    packages.set(
      `${findingSlug(single.path)}.md`,
      offenderPackage(result, single, null, refs, deletionReasons.get(single.path)),
    );
    packagedPaths.add(single.path);
  }
  // DELETE__ packages only for deletion candidates with no finding
  // package of their own — one file per path, never two copies.
  for (const deletion of deletions) {
    if (packagedPaths.has(deletion.path)) continue;
    packages.set(
      `DELETE__${findingSlug(deletion.path)}.md`,
      deletionPackage(result, deletion.path, deletion.reason, refs),
    );
  }
  return packages;
}
