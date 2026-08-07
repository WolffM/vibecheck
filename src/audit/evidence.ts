/**
 * Evidence deepening (round 3)
 *
 * The round-2 briefing prescribed investigations ("verify unreachable,
 * then delete"); round 3 runs them. Two instruments:
 *
 *  - string-reference scan: for each deletion candidate, sweep every
 *    candidate file for mentions of its basename. Zero hits = the
 *    verification the briefing used to delegate; hits = the loading
 *    mechanism, named, which usually explains a false orphan.
 *  - symbol map: top-level functions/classes/consts with line spans, so
 *    "split this file" comes with the actual cut points. Regex-based —
 *    good enough to point at boundaries, never claimed as a parse.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Stable filename slug for a finding's package file. */
export function findingSlug(path: string): string {
  return path.replace(/[^\w.-]+/g, "__");
}

export interface StringReference {
  file: string;
  line: number;
  text: string;
}

/**
 * Sweep candidate files for mentions of each target's basename (without
 * extension). Self-references, the target's own directory listing, and
 * lockfiles are excluded. Capped per target to keep packages readable.
 */
export function stringReferenceScan(
  rootPath: string,
  candidateFiles: string[],
  targets: string[],
  capPerTarget = 5,
): Map<string, StringReference[]> {
  // Two needles per target: the full basename ("editor.js" — high
  // precision), and the stem only when bounded like a module specifier
  // (`'./editor'`, `/editor"`) — a bare stem like "editor" matches prose.
  const needles = new Map<string, { base: string; stemPattern: RegExp | null }>();
  for (const target of targets) {
    const base = target.slice(target.lastIndexOf("/") + 1);
    const stem = base.slice(0, base.lastIndexOf(".")) || base;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    needles.set(target, {
      base,
      stemPattern:
        stem.length >= 3 && stem !== base
          ? new RegExp(`[/'"\`]${escaped}['"\`]`)
          : null,
    });
  }
  const hits = new Map<string, StringReference[]>();
  for (const target of targets) hits.set(target, []);

  for (const file of candidateFiles) {
    if (targets.includes(file)) continue;
    let source: string;
    try {
      source = readFileSync(join(rootPath, file), "utf-8");
    } catch {
      continue;
    }
    // Cheap pre-filter before line-splitting.
    const relevant = [...needles.entries()].filter(
      ([target, n]) =>
        target !== file &&
        (source.includes(n.base) || (n.stemPattern?.test(source) ?? false)),
    );
    if (relevant.length === 0) continue;
    const lines = source.split("\n");
    for (const [target, n] of relevant) {
      const list = hits.get(target) as StringReference[];
      if (list.length >= capPerTarget) continue;
      for (let i = 0; i < lines.length && list.length < capPerTarget; i++) {
        if (
          lines[i].includes(n.base) ||
          (n.stemPattern?.test(lines[i]) ?? false)
        ) {
          list.push({ file, line: i + 1, text: lines[i].trim().slice(0, 120) });
        }
      }
    }
  }
  return hits;
}

export interface SymbolSpan {
  name: string;
  kind: string;
  start: number;
  end: number;
  lines: number;
}

const TSJS_SYMBOL =
  /^(?:export\s+)?(?:default\s+)?(async\s+function|function|class|const|let|interface|type|enum)\s+([\w$]+)/;
const PY_SYMBOL = /^(async\s+def|def|class)\s+([\w]+)/;

/**
 * Top-level symbols with approximate spans. A symbol ends where the next
 * top-level symbol begins (or EOF) — crude but exactly the granularity a
 * split decision needs.
 */
export function extractSymbolMap(
  rootPath: string,
  file: string,
): SymbolSpan[] {
  let source: string;
  try {
    source = readFileSync(join(rootPath, file), "utf-8");
  } catch {
    return [];
  }
  const isPython = file.endsWith(".py");
  const pattern = isPython ? PY_SYMBOL : TSJS_SYMBOL;
  const lines = source.split("\n");
  const starts: { name: string; kind: string; start: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (!match) continue;
    // Top-level only: no leading indentation.
    if (/^\s/.test(lines[i])) continue;
    starts.push({ kind: match[1], name: match[2], start: i + 1 });
  }
  const symbols: SymbolSpan[] = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].start - 1 : lines.length;
    symbols.push({
      ...starts[i],
      end,
      lines: end - starts[i].start + 1,
    });
  }
  return symbols;
}

/** The handful of biggest symbols — the natural split candidates. */
export function largestSymbols(
  symbols: SymbolSpan[],
  count = 6,
): SymbolSpan[] {
  return [...symbols]
    .filter((s) => s.lines >= 10)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, count);
}
