/**
 * Decision ledger (design §5)
 *
 * Append-only JSONL at .vibecompact/ledger.jsonl. Every event carries a
 * ULID assigned at write time; the fold orders by (at, id) and dedupes on
 * id — a total order deterministic across any merge history (the file
 * merges with `merge=union`, so duplicates and arbitrary interleavings
 * are normal, not errors).
 *
 * Human verdicts (justified / wontfix / noise) arrive via the CLI; the
 * audit run itself stamps machine events (firing / fixed). Floors derive
 * from noise verdicts at fold time: ≥3 distinct attested fingerprints per
 * lane move the floor one quantized step, capped at 2 steps, reversible
 * only by an explicit floor-reset event, never time-decayed.
 */

import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { LANE_ANCHORS } from "./scoring.js";

// ============================================================================
// Constants (behavioral, §10.1 taxonomy)
// ============================================================================

/** Distinct noise-attested fingerprints per lane before the floor moves. */
export const RATCHET_QUORUM = 3;
/** Maximum quantized floor steps per lane. */
export const RATCHET_CAP = 2;
/** One quantized step, as a fraction of the lane anchor. */
export const FLOOR_STEP_FRACTION = 0.25;
/** Default justified-verdict age expiry (days) — refresh-and-quote. */
export const JUSTIFIED_MAX_AGE_DAYS = 180;
/** Default growth invalidation for justified verdicts (percent). */
export const JUSTIFIED_GROWTH_PCT = 20;

export const LEDGER_PATH = ".vibecompact/ledger.jsonl";

// ============================================================================
// ULID
// ============================================================================

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let ulidLastTime = -1;
let ulidLastRand: number[] = [];

/**
 * 26-char ULID: 48-bit timestamp + 80-bit randomness, Crockford base32.
 * Monotonic within a process: same-millisecond calls increment the
 * random part, so events created in order also *sort* in order — the
 * fold's (at, id) tiebreak must never invert creation order from a
 * single writer (e.g. three noise verdicts then a floor reset inside
 * one millisecond).
 */
export function makeUlid(time: number = Date.now()): string {
  let ts = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[t % 32] + ts;
    t = Math.floor(t / 32);
  }

  if (time === ulidLastTime) {
    for (let i = ulidLastRand.length - 1; i >= 0; i--) {
      if (ulidLastRand[i] < 31) {
        ulidLastRand[i]++;
        break;
      }
      ulidLastRand[i] = 0;
    }
  } else {
    ulidLastTime = time;
    const bytes = randomBytes(10);
    const digits: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const byte of bytes) {
      acc = (acc << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        digits.push((acc >>> (bits - 5)) & 31);
        bits -= 5;
      }
    }
    ulidLastRand = digits.slice(0, 16);
  }
  return ts + ulidLastRand.map((d) => CROCKFORD[d]).join("");
}

// ============================================================================
// Event types
// ============================================================================

export type HumanVerdict = "justified" | "wontfix" | "noise";

export interface VerdictEvent {
  id: string;
  /** ISO-8601 UTC datetime. */
  at: string;
  verdict: HumanVerdict;
  fingerprint: string;
  reason: string;
  baseline?: { codeLines?: number; sha?: string };
  invalidateWhen?: { growthPct?: number; maxAgeDays?: number };
}

export interface FiringEvent {
  id: string;
  at: string;
  kind: "firing";
  fingerprint: string;
  score: number;
  threshold: number;
}

export interface FixedEvent {
  id: string;
  at: string;
  verdict: "fixed";
  fingerprint: string;
  score: number;
  threshold: number;
}

export interface FloorResetEvent {
  id: string;
  at: string;
  kind: "floor-reset";
  lane: string;
}

export interface RenameEvent {
  id: string;
  at: string;
  kind: "rename";
  from: string;
  to: string;
}

/**
 * Machine-stamped when the publish path observes that a findings PR was
 * closed since the last acknowledgment: the maintainer has seen that
 * batch. A new findings PR opens only for firings newer than the latest
 * acknowledgment — closure is a signal, not an accident (episodic-PR
 * redesign, hadoku_site handoff 2026-08-17).
 */
export interface AcknowledgedEvent {
  id: string;
  at: string;
  kind: "acknowledged";
  /** Anchor the acknowledged batch was generated at, when known. */
  anchor?: string;
  /** The findings PR whose closure recorded this acknowledgment. */
  prNumber: number;
}

export type LedgerEvent =
  | VerdictEvent
  | FiringEvent
  | FixedEvent
  | FloorResetEvent
  | RenameEvent
  | AcknowledgedEvent;

/** `<lane>:<path>` — the design's fingerprint shape for lane findings. */
export function laneOf(fingerprint: string): string {
  const idx = fingerprint.indexOf(":");
  return idx === -1 ? fingerprint : fingerprint.slice(0, idx);
}

export function pathOf(fingerprint: string): string {
  const idx = fingerprint.indexOf(":");
  return idx === -1 ? "" : fingerprint.slice(idx + 1);
}

export function makeFingerprint(lane: string, path: string): string {
  return `${lane}:${path}`;
}

// ============================================================================
// Storage
// ============================================================================

export function readLedger(rootPath: string): LedgerEvent[] {
  const file = join(rootPath, LEDGER_PATH);
  if (!existsSync(file)) return [];
  const events: LedgerEvent[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LedgerEvent;
      if (parsed.id && parsed.at) events.push(parsed);
    } catch {
      console.warn(`ledger: skipping unparseable line: ${trimmed.slice(0, 80)}`);
    }
  }
  return events;
}

/**
 * Rewrite the ledger file as the ordered, deduped union of its current
 * content and `extra`. Used by the CI publish path so the force-pushed
 * data branch never drops machine events that only ever lived there.
 */
export function writeUnionLedger(
  rootPath: string,
  extra: LedgerEvent[],
): number {
  const events = [...readLedger(rootPath), ...extra];
  const seen = new Set<string>();
  const ordered = events
    .sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  const file = join(rootPath, LEDGER_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    ordered.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf-8",
  );
  return ordered.length;
}

export function appendEvents(rootPath: string, events: LedgerEvent[]): void {
  if (events.length === 0) return;
  const file = join(rootPath, LEDGER_PATH);
  mkdirSync(dirname(file), { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(file, lines, "utf-8");
}

// ============================================================================
// Fold
// ============================================================================

export interface FiringState {
  fingerprint: string;
  score: number;
  threshold: number;
  firedAt: string;
  /** Set when a later fixed event closed this firing. */
  fixedAt?: string;
}

export interface LedgerFold {
  /** Ordered, deduped event stream the fold was computed from. */
  events: LedgerEvent[];
  /** Latest human verdict per (rename-migrated) fingerprint. */
  verdicts: Map<string, VerdictEvent>;
  /** Firing state machine per fingerprint (fixed closes, refire reopens). */
  firing: Map<string, FiringState>;
  /** Distinct noise-attested fingerprints per lane since last reset. */
  noiseByLane: Map<string, Set<string>>;
  /** Quantized floor steps per lane (quorum + cap applied). */
  floorSteps: Map<string, number>;
  /** Latest batch acknowledgment (findings-PR closure), if any. */
  lastAcknowledged: AcknowledgedEvent | null;
  /** Rename chain resolution old → final path. */
  resolvePath: (path: string) => string;
}

function orderAndDedupe(events: LedgerEvent[]): LedgerEvent[] {
  const seen = new Set<string>();
  return [...events]
    .sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
}

export function foldLedger(rawEvents: LedgerEvent[]): LedgerFold {
  const events = orderAndDedupe(rawEvents);

  // Rename chains compose across events; cycles guard via visited set.
  const renames = new Map<string, string>();
  for (const event of events) {
    if ("kind" in event && event.kind === "rename") {
      renames.set(event.from, event.to);
    }
  }
  const resolvePath = (path: string): string => {
    let current = path;
    const visited = new Set<string>([current]);
    while (renames.has(current)) {
      const next = renames.get(current) as string;
      if (visited.has(next)) break;
      visited.add(next);
      current = next;
    }
    return current;
  };
  const migrate = (fingerprint: string): string => {
    const lane = laneOf(fingerprint);
    const path = pathOf(fingerprint);
    return path ? makeFingerprint(lane, resolvePath(path)) : fingerprint;
  };

  const verdicts = new Map<string, VerdictEvent>();
  const firing = new Map<string, FiringState>();
  const noiseByLane = new Map<string, Set<string>>();
  let lastAcknowledged: AcknowledgedEvent | null = null;

  for (const event of events) {
    if ("kind" in event) {
      if (event.kind === "floor-reset") {
        noiseByLane.set(event.lane, new Set());
      } else if (event.kind === "acknowledged") {
        lastAcknowledged = event;
      } else if (event.kind === "firing") {
        const fp = migrate(event.fingerprint);
        firing.set(fp, {
          fingerprint: fp,
          score: event.score,
          threshold: event.threshold,
          firedAt: event.at,
        });
      }
      continue;
    }
    const fp = migrate(event.fingerprint);
    if (event.verdict === "fixed") {
      const state = firing.get(fp);
      if (state && !state.fixedAt) state.fixedAt = event.at;
      continue;
    }
    verdicts.set(fp, { ...event, fingerprint: fp });
    if (event.verdict === "noise") {
      const lane = laneOf(fp);
      const set = noiseByLane.get(lane) ?? new Set<string>();
      set.add(fp);
      noiseByLane.set(lane, set);
    }
  }

  const floorSteps = new Map<string, number>();
  for (const [lane, set] of noiseByLane) {
    floorSteps.set(
      lane,
      Math.min(RATCHET_CAP, Math.floor(set.size / RATCHET_QUORUM)),
    );
  }

  return {
    events,
    verdicts,
    firing,
    noiseByLane,
    floorSteps,
    lastAcknowledged,
    resolvePath,
  };
}

/**
 * Standing firings newer than the latest acknowledgment — the content
 * of the next findings batch. Fixed firings are spent; with no
 * acknowledgment yet, every standing firing is new (bootstrap).
 */
export function firingsSinceAcknowledged(fold: LedgerFold): FiringState[] {
  const since = fold.lastAcknowledged?.at ?? "";
  return [...fold.firing.values()].filter(
    (s) => !s.fixedAt && s.firedAt > since,
  );
}

/** Absolute per-lane floors for scoring: anchor × (1 + step-fraction × steps). */
export function floorsForScoring(fold: LedgerFold): Record<string, number> {
  const floors: Record<string, number> = {};
  for (const [lane, steps] of fold.floorSteps) {
    const anchor = LANE_ANCHORS[lane];
    if (anchor === undefined || steps === 0) continue;
    floors[lane] = anchor * (1 + FLOOR_STEP_FRACTION * steps);
  }
  return floors;
}

// ============================================================================
// Verdict resolution (suppression, aging, growth invalidation)
// ============================================================================

export type VerdictStatus =
  | "none"
  | "justified"
  | "justified-aging"
  | "reopened-growth"
  | "wontfix"
  | "noise";

export interface ResolvedVerdict {
  fingerprint: string;
  status: VerdictStatus;
  /** Suppress the finding from worst offenders? */
  suppressed: boolean;
  event?: VerdictEvent;
}

export interface VerdictContext {
  /** Audit anchor datetime — never wall clock (determinism). */
  anchorDate: string;
  /** Current scc code lines per path, for growth invalidation. */
  codeLines?: Map<string, number>;
}

export function resolveVerdict(
  fold: LedgerFold,
  fingerprint: string,
  ctx: VerdictContext,
): ResolvedVerdict {
  const event = fold.verdicts.get(fingerprint);
  if (!event) return { fingerprint, status: "none", suppressed: false };

  if (event.verdict === "wontfix") {
    return { fingerprint, status: "wontfix", suppressed: true, event };
  }
  if (event.verdict === "noise") {
    return { fingerprint, status: "noise", suppressed: true, event };
  }

  // justified: growth invalidation is a hard re-open; age is refresh-and-quote.
  const growthPct = event.invalidateWhen?.growthPct ?? JUSTIFIED_GROWTH_PCT;
  const baseline = event.baseline?.codeLines;
  const current = ctx.codeLines?.get(pathOf(fingerprint));
  if (
    baseline !== undefined &&
    current !== undefined &&
    current > baseline * (1 + growthPct / 100)
  ) {
    return { fingerprint, status: "reopened-growth", suppressed: false, event };
  }

  const maxAgeDays = event.invalidateWhen?.maxAgeDays ?? JUSTIFIED_MAX_AGE_DAYS;
  const ageDays =
    (Date.parse(ctx.anchorDate) - Date.parse(event.at)) / (24 * 60 * 60 * 1000);
  if (ageDays > maxAgeDays) {
    return { fingerprint, status: "justified-aging", suppressed: true, event };
  }
  return { fingerprint, status: "justified", suppressed: true, event };
}

// ============================================================================
// Rename migration pass
// ============================================================================

/**
 * Ledger keys whose paths vanished from the tracked set but resolve
 * through git's rename map get a rename event appended (once); the fold
 * then reads their history under the new path.
 */
export function computeRenameEvents(
  fold: LedgerFold,
  renames: Map<string, string>,
  trackedFiles: Set<string>,
  at: string,
): RenameEvent[] {
  const follow = (path: string): string => {
    let current = path;
    const visited = new Set([current]);
    while (renames.has(current)) {
      const next = renames.get(current) as string;
      if (visited.has(next)) break;
      visited.add(next);
      current = next;
    }
    return current;
  };

  const events: RenameEvent[] = [];
  const emitted = new Set<string>();
  const fingerprints = new Set([...fold.verdicts.keys(), ...fold.firing.keys()]);
  for (const fingerprint of fingerprints) {
    const path = pathOf(fingerprint);
    if (!path || trackedFiles.has(path)) continue;
    const target = follow(path);
    if (target === path || !trackedFiles.has(target)) continue;
    const key = `${path}|${target}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    events.push({
      id: makeUlid(Date.parse(at)),
      at,
      kind: "rename",
      from: path,
      to: target,
    });
  }
  return events;
}

// ============================================================================
// Run stamping: firing + fixed with hysteresis
// ============================================================================

/**
 * Compute the machine events an audit run should append. Hysteresis: a
 * firing closes as fixed only when the score drops below the original
 * firing threshold minus one quantization step — files oscillating at the
 * threshold never flap fixed/refired.
 */
export function computeRunEvents(
  fold: LedgerFold,
  currentScores: Map<string, { score: number; threshold: number }>,
  at: string,
  /** Lanes with no signal this run (e.g. saturation-muted) — their
   * absence from currentScores must not mass-stamp `fixed`. */
  skipLanes: Set<string> = new Set(),
): LedgerEvent[] {
  const events: LedgerEvent[] = [];

  for (const [fingerprint, { score, threshold }] of currentScores) {
    if (score < threshold) continue;
    const state = fold.firing.get(fingerprint);
    if (!state || state.fixedAt) {
      events.push({
        id: makeUlid(Date.parse(at)),
        at,
        kind: "firing",
        fingerprint,
        score,
        threshold,
      });
    }
  }

  for (const [fingerprint, state] of fold.firing) {
    if (state.fixedAt) continue;
    const lane = laneOf(fingerprint);
    if (skipLanes.has(lane)) continue;
    const anchor = LANE_ANCHORS[lane];
    if (anchor === undefined) continue;
    const hysteresis = anchor * FLOOR_STEP_FRACTION;
    const current = currentScores.get(fingerprint);
    const score = current?.score ?? 0;
    if (score < state.threshold - hysteresis) {
      events.push({
        id: makeUlid(Date.parse(at)),
        at,
        verdict: "fixed",
        fingerprint,
        score,
        threshold: state.threshold,
      });
    }
  }

  return events;
}
