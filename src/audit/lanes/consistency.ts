/**
 * L7 · Consistency & redundant infrastructure lane (state-descriptive,
 * in-house)
 *
 * Signals per design §3.1-L7:
 *  - copy artifacts (1.0): a suffixed sibling (`utils_v2.ts`) fires only
 *    when the unsuffixed sibling coexists; barrel/entry names excluded.
 *  - orphaned files (0.8, headline billing): zero import fan-in, not an
 *    entry point by convention or package.json reference. TS/JS only
 *    (graph jurisdiction), heuristics disclosed.
 *  - import cycles (0.5): below the anchor by design — context that can
 *    corroborate, never a solo alarm.
 *  - category table: curated concerns (≤10), unit = import sites per
 *    package. Within a package using ≥2 providers, minority-provider
 *    import sites score 0.7; across packages it is a context line only.
 *
 * File score = max(signals). State lane: inspection + noise verdicts are
 * the validation instrument, never outcome fitting.
 */

import { dirname } from "node:path";
import { detectEntryPoints } from "../entrypoints.js";
import { isTestFile } from "../git-arrival.js";
import { isTsJsFile, type ImportData } from "../import-graph.js";

const COPY_SCORE = 1.0;
const ORPHAN_SCORE = 0.8;
const CYCLE_SCORE = 0.5;
const MINORITY_PROVIDER_SCORE = 0.7;

/** Curated category table — capped at 10 by design. */
export const CONSISTENCY_CATEGORIES: Record<string, string[]> = {
  "http-client": ["axios", "got", "node-fetch", "superagent", "ky", "undici", "request"],
  dates: ["moment", "dayjs", "date-fns", "luxon"],
  logging: ["winston", "pino", "bunyan", "log4js", "loglevel"],
  testing: ["jest", "vitest", "mocha", "ava", "jasmine"],
  state: ["redux", "@reduxjs/toolkit", "zustand", "mobx", "jotai", "recoil", "valtio"],
  validation: ["joi", "yup", "zod", "ajv", "superstruct", "valibot"],
  "db-orm": ["prisma", "@prisma/client", "typeorm", "sequelize", "knex", "drizzle-orm", "mongoose"],
  styling: ["styled-components", "@emotion/react", "@emotion/styled"],
  utility: ["lodash", "lodash-es", "underscore", "ramda", "remeda"],
  "id-generation": ["uuid", "nanoid", "ulid", "cuid", "@paralleldrive/cuid2"],
};

const BARREL_NAMES = /^(index|mod|__init__|main)\.[^.]+$/;
const COPY_SUFFIX =
  /^(.+?)[-_.](v\d+|\d+|old|new|copy|backup|bak|final|fixed|temp|tmp|orig|legacy)$/i;

/** `utils_v2.ts` → `utils` when the name carries a copy suffix. */
export function copyArtifactBase(basename: string): string | null {
  if (BARREL_NAMES.test(basename)) return null;
  const dot = basename.lastIndexOf(".");
  const stem = dot === -1 ? basename : basename.slice(0, dot);
  const match = stem.match(COPY_SUFFIX);
  if (!match) return null;
  if (BARREL_NAMES.test(`${match[1]}.x`)) return null;
  return match[1];
}

const ORPHAN_EXEMPT_DIRS =
  /(^|\/)(bin|scripts|tools|examples|docs|\.github|pages|app|api|routes|migrations|functions|workers|fixtures|test-fixtures|__fixtures__|public|static)\//;
const ORPHAN_EXEMPT_NAMES =
  /(^|\/|[-_.])(index|main|cli|app|server|setup|entry)\.[^.]+$|\.config\.[^.]+$|\.d\.ts$|rc\.(js|cjs|mjs)$|(^|\/)\.[^/]+$/;


/** Tarjan SCC — cycle members of size ≥2 (self-loops excluded upstream). */
export function findCycleMembers(
  graph: Map<string, string[]>,
): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const members = new Map<string, number>();
  let counter = 0;

  const strongConnect = (start: string): void => {
    interface Frame {
      node: string;
      neighbors: string[];
      next: number;
    }
    const frames: Frame[] = [
      { node: start, neighbors: graph.get(start) ?? [], next: 0 },
    ];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.next < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.next++];
        if (!graph.has(neighbor)) continue;
        if (!index.has(neighbor)) {
          index.set(neighbor, counter);
          low.set(neighbor, counter);
          counter++;
          stack.push(neighbor);
          onStack.add(neighbor);
          frames.push({
            node: neighbor,
            neighbors: graph.get(neighbor) ?? [],
            next: 0,
          });
        } else if (onStack.has(neighbor)) {
          low.set(
            frame.node,
            Math.min(low.get(frame.node) as number, index.get(neighbor) as number),
          );
        }
      } else {
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent) {
          low.set(
            parent.node,
            Math.min(
              low.get(parent.node) as number,
              low.get(frame.node) as number,
            ),
          );
        }
        if (low.get(frame.node) === index.get(frame.node)) {
          const component: string[] = [];
          let popped: string;
          do {
            popped = stack.pop() as string;
            onStack.delete(popped);
            component.push(popped);
          } while (popped !== frame.node);
          if (component.length >= 2) {
            for (const member of component) {
              members.set(member, component.length);
            }
          }
        }
      }
    }
  };

  for (const node of graph.keys()) {
    if (!index.has(node)) strongConnect(node);
  }
  return members;
}

/** Nearest ancestor dir with a package.json; "" = repo root package. */
function packageOf(path: string, packageDirs: string[]): string {
  let best = "";
  for (const dir of packageDirs) {
    if (dir !== "" && (path === dir || path.startsWith(dir + "/"))) {
      if (dir.length > best.length) best = dir;
    }
  }
  return best;
}

export interface CategoryFinding {
  category: string;
  packageDir: string;
  /** provider → import-site count within the package. */
  providers: Record<string, number>;
  majority: string;
}

export interface ConsistencyLaneEntry {
  path: string;
  applicable: true;
  copyArtifactOf?: string;
  orphan?: boolean;
  cycleSize?: number;
  minorityOf?: string;
  score: number;
}

export interface ConsistencyLaneResult {
  lane: "consistency";
  available: true;
  disclosures: string[];
  /** Within-package multi-provider concerns (also the report table). */
  categoryFindings: CategoryFinding[];
  entries: ConsistencyLaneEntry[];
}

const CODE_EXTENSIONS =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|cs|rb|php|c|h|cpp|hpp|cc|swift|scala|ex|exs)$/;

export function buildConsistencyLane(
  rootPath: string,
  candidateFiles: string[],
  importData: ImportData,
  entryPoints?: Set<string>,
): ConsistencyLaneResult {
  const disclosures: string[] = [
    "orphan + cycle + category signals are TS/JS-only (import-graph jurisdiction); copy artifacts are language-agnostic",
  ];

  const codeFiles = candidateFiles.filter(
    (f) => CODE_EXTENSIONS.test(f) && !isTestFile(f),
  );
  const candidateSet = new Set(candidateFiles);

  // --- copy artifacts -----------------------------------------------------
  const copyArtifacts = new Map<string, string>();
  for (const path of codeFiles) {
    const slash = path.lastIndexOf("/");
    const dir = slash === -1 ? "" : path.slice(0, slash + 1);
    const basename = slash === -1 ? path : path.slice(slash + 1);
    const base = copyArtifactBase(basename);
    if (!base) continue;
    const ext = basename.slice(basename.lastIndexOf("."));
    const sibling = `${dir}${base}${ext}`;
    if (candidateSet.has(sibling)) copyArtifacts.set(path, sibling);
  }

  // --- orphans ------------------------------------------------------------
  const fanIn = new Map<string, number>();
  for (const targets of importData.graph.values()) {
    for (const target of targets) {
      fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
    }
  }
  const declaredEntries =
    entryPoints ?? detectEntryPoints(rootPath, candidateFiles).entries;
  const orphans = new Set<string>();
  for (const path of codeFiles) {
    if (!isTsJsFile(path) || !importData.graph.has(path)) continue;
    if ((fanIn.get(path) ?? 0) > 0) continue;
    if (ORPHAN_EXEMPT_DIRS.test(path) || ORPHAN_EXEMPT_NAMES.test(path)) continue;
    if (declaredEntries.has(path)) continue;
    orphans.add(path);
  }

  // --- cycles -------------------------------------------------------------
  const cycleMembers = findCycleMembers(importData.graph);

  // --- category table -----------------------------------------------------
  const packageDirs = [
    "",
    ...candidateFiles
      .filter((f) => f.endsWith("/package.json"))
      .map((f) => dirname(f)),
  ];
  const providerOf = new Map<string, { category: string }>();
  for (const [category, providers] of Object.entries(CONSISTENCY_CATEGORIES)) {
    for (const provider of providers) providerOf.set(provider, { category });
  }
  // (package, category, provider) → import sites + files
  const sites = new Map<string, Map<string, { count: number; files: string[] }>>();
  for (const [file, packages] of importData.packageImports) {
    if (isTestFile(file)) continue;
    const pkg = packageOf(file, packageDirs);
    for (const imported of packages) {
      const hit = providerOf.get(imported);
      if (!hit) continue;
      const key = `${pkg} ${hit.category}`;
      const byProvider = sites.get(key) ?? new Map();
      const cell = byProvider.get(imported) ?? { count: 0, files: [] };
      cell.count++;
      cell.files.push(file);
      byProvider.set(imported, cell);
      sites.set(key, byProvider);
    }
  }
  const categoryFindings: CategoryFinding[] = [];
  const minorityFiles = new Map<string, string>();
  for (const [key, byProvider] of sites) {
    if (byProvider.size < 2) continue;
    const [packageDir, category] = key.split(" ");
    const ranked = [...byProvider.entries()].sort(
      (a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1),
    );
    const majority = ranked[0][0];
    categoryFindings.push({
      category,
      packageDir,
      providers: Object.fromEntries(
        ranked.map(([provider, cell]) => [provider, cell.count]),
      ),
      majority,
    });
    for (const [provider, cell] of ranked.slice(1)) {
      for (const file of cell.files) {
        minorityFiles.set(file, `${category}: ${provider} vs ${majority}`);
      }
    }
  }
  categoryFindings.sort((a, b) =>
    `${a.packageDir} ${a.category}` < `${b.packageDir} ${b.category}` ? -1 : 1,
  );

  // --- assemble -----------------------------------------------------------
  const entries: ConsistencyLaneEntry[] = [];
  for (const path of codeFiles) {
    const copyOf = copyArtifacts.get(path);
    const orphan = orphans.has(path);
    const cycleSize = cycleMembers.get(path);
    const minorityOf = minorityFiles.get(path);
    const score = Math.max(
      copyOf ? COPY_SCORE : 0,
      orphan ? ORPHAN_SCORE : 0,
      cycleSize ? CYCLE_SCORE : 0,
      minorityOf ? MINORITY_PROVIDER_SCORE : 0,
    );
    entries.push({
      path,
      applicable: true,
      ...(copyOf ? { copyArtifactOf: copyOf } : {}),
      ...(orphan ? { orphan: true } : {}),
      ...(cycleSize ? { cycleSize } : {}),
      ...(minorityOf ? { minorityOf } : {}),
      score,
    });
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    lane: "consistency",
    available: true,
    disclosures,
    categoryFindings,
    entries,
  };
}
