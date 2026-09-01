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
  // precision), and the stem only inside a quoted path with a slash
  // before it (`'./editor'`, `"lib/editor"`) — a bare quoted stem like
  // `"build"` is an npm script name, not a module specifier, and
  // matching it produced fake references (round-7: `"vite build"`
  // counted as a hit for build.js).
  const needles = new Map<string, { base: string; stemPattern: RegExp | null }>();
  for (const target of targets) {
    const base = target.slice(target.lastIndexOf("/") + 1);
    const stem = base.slice(0, base.lastIndexOf(".")) || base;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    needles.set(target, {
      base,
      stemPattern:
        stem.length >= 3 && stem !== base
          ? new RegExp(`['"\`][\\w.@-]*(?:/[\\w.@-]+)*/${escaped}['"\`]|['"\`]\\.{1,2}/${escaped}['"\`]`)
          : null,
    });
  }
  const hits = new Map<string, StringReference[]>();
  for (const target of targets) hits.set(target, []);

  for (const file of candidateFiles) {
    // A target may be referenced by another target (round-7: build.js
    // reads editor.js, both deletion candidates) — only self-references
    // are excluded, per pair, below.
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
  /** True when the extent could not be measured and the span falls back
   * to the next declaration — the package must say so rather than
   * assert a number it did not verify. */
  approximate?: boolean;
}

const TSJS_SYMBOL =
  /^(?:export\s+)?(?:default\s+)?(async\s+function|function|class|const|let|interface|type|enum)\s+([\w$]+)/;
const PY_SYMBOL = /^(async\s+def|def|class)\s+([\w]+)/;

/**
 * Real extent of the symbol starting at `startIdx`, as an inclusive end
 * index — brace depth for TS/JS, indentation for Python.
 *
 * The previous implementation ended a symbol where the *next* one began,
 * which attributed every intervening route registration, `useEffect`,
 * const and JSX return to whichever declaration preceded it. Field
 * reports #380/#386: a 13-line function claimed 777 lines and a 4-line
 * handler claimed 406, so "suggested first cut" named the smallest
 * symbol in the file. Returns null when the extent cannot be determined
 * (unbalanced by an unhandled construct), so callers can fall back and
 * say the number is approximate rather than assert a wrong one.
 */
export function measureExtent(
  lines: string[],
  startIdx: number,
  isPython: boolean,
): number | null {
  if (isPython) {
    const line = lines[startIdx];
    const baseIndent = line.length - line.trimStart().length;
    let end = startIdx;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const text = lines[i];
      if (!text.trim()) continue;
      const indent = text.length - text.trimStart().length;
      if (indent <= baseIndent) return end;
      end = i;
    }
    return end;
  }

  let depth = 0;
  let sawBrace = false;
  let inBlockComment = false;
  let quote: string | null = null;
  for (let i = startIdx; i < lines.length; i++) {
    const text = lines[i];
    for (let c = 0; c < text.length; c++) {
      const ch = text[c];
      const next = text[c + 1];
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          c++;
        }
        continue;
      }
      if (quote) {
        if (ch === "\\") c++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && next === "/") break; // line comment
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        c++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{" || ch === "(" || ch === "[") {
        depth++;
        if (ch === "{") sawBrace = true;
        continue;
      }
      if (ch === "}" || ch === ")" || ch === "]") {
        depth--;
        if (depth < 0) return null; // unbalanced — do not guess
        if (depth === 0 && sawBrace) return i;
        continue;
      }
      // A braceless declaration (`type X = string;`, `const n = 1;`)
      // ends at its statement terminator.
      if (ch === ";" && depth === 0 && !sawBrace) return i;
    }
    // A braceless declaration with no semicolon ends at its own line,
    // provided nothing is left open.
    if (depth === 0 && !sawBrace && i > startIdx) return i - 1;
  }
  return null;
}

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
  const lines = splitLines(source);
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
    const boundary =
      i + 1 < starts.length ? starts[i + 1].start - 1 : lines.length;
    const measured = measureExtent(lines, starts[i].start - 1, isPython);
    // Never let a measured extent run past the next declaration: that
    // would mean the scanner lost track, and the boundary is the safe
    // upper bound.
    const end =
      measured !== null && measured + 1 <= boundary ? measured + 1 : boundary;
    symbols.push({
      ...starts[i],
      end,
      lines: end - starts[i].start + 1,
      approximate: measured === null,
    });
  }
  return symbols;
}

/** Line array for span math — a trailing newline is not a line. */
function splitLines(source: string): string[] {
  const lines = source.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const NESTED_TSJS_SYMBOL =
  /^\s+(?:export\s+)?(async\s+function|function|class)\s+([\w$]+)/;
const NESTED_PY_SYMBOL = /^\s+(async\s+def|def|class)\s+([\w]+)/;

/**
 * Named symbols nested one level inside a span — the cut points when a
 * single symbol IS the file and "extract it" would be a no-op. Shallowest
 * indentation wins: deeper nesting belongs to those sections, not the
 * split decision.
 */
export function extractNestedSymbols(
  rootPath: string,
  file: string,
  span: { start: number; end: number },
): SymbolSpan[] {
  let source: string;
  try {
    source = readFileSync(join(rootPath, file), "utf-8");
  } catch {
    return [];
  }
  const isPython = file.endsWith(".py");
  const pattern = isPython ? NESTED_PY_SYMBOL : NESTED_TSJS_SYMBOL;
  const lines = splitLines(source);
  const starts: { name: string; kind: string; start: number; indent: number }[] =
    [];
  for (let i = span.start; i < Math.min(span.end, lines.length); i++) {
    const match = lines[i].match(pattern);
    if (!match) continue;
    starts.push({
      kind: match[1],
      name: match[2],
      start: i + 1,
      indent: lines[i].length - lines[i].trimStart().length,
    });
  }
  if (starts.length === 0) return [];
  const minIndent = Math.min(...starts.map((s) => s.indent));
  const shallow = starts.filter((s) => s.indent === minIndent);
  const symbols: SymbolSpan[] = [];
  for (let i = 0; i < shallow.length; i++) {
    const boundary = i + 1 < shallow.length ? shallow[i + 1].start - 1 : span.end;
    const measured = measureExtent(lines, shallow[i].start - 1, isPython);
    const end =
      measured !== null && measured + 1 <= boundary ? measured + 1 : boundary;
    symbols.push({
      name: shallow[i].name,
      kind: shallow[i].kind,
      start: shallow[i].start,
      end,
      lines: end - shallow[i].start + 1,
      approximate: measured === null,
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
