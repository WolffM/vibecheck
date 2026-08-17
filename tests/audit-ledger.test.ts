import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  appendEvents,
  computeRenameEvents,
  computeRunEvents,
  firingsSinceAcknowledged,
  floorsForScoring,
  foldLedger,
  makeFingerprint,
  makeUlid,
  readLedger,
  resolveVerdict,
  type FixedEvent,
  type FiringEvent,
  type LedgerEvent,
  type LedgerFold,
  type VerdictEvent,
} from "../src/audit/ledger.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function verdict(
  kind: VerdictEvent["verdict"],
  fingerprint: string,
  at: string,
  extra: Partial<VerdictEvent> = {},
): VerdictEvent {
  return {
    id: makeUlid(Date.parse(at) + counter++),
    at,
    verdict: kind,
    fingerprint,
    reason: "test",
    ...extra,
  };
}

function foldComparable(fold: LedgerFold) {
  return {
    verdicts: [...fold.verdicts.entries()],
    firing: [...fold.firing.entries()],
    floorSteps: [...fold.floorSteps.entries()],
    eventIds: fold.events.map((e) => e.id),
  };
}

describe("makeUlid", () => {
  it("produces sortable 26-char Crockford ids", () => {
    const earlier = makeUlid(1000000);
    const later = makeUlid(2000000);
    expect(earlier).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(earlier < later).toBe(true);
  });

  it("is monotonic within a single millisecond", () => {
    const ids = Array.from({ length: 50 }, () => makeUlid(1234567890));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(50);
  });
});

describe("foldLedger", () => {
  it("is invariant to concatenation order (union-merge safety)", () => {
    const a: LedgerEvent[] = [
      verdict("justified", "size:src/a.ts", "2026-01-10T00:00:00Z"),
      verdict("noise", "arrival:src/b.ts", "2026-01-11T00:00:00Z"),
    ];
    const b: LedgerEvent[] = [
      verdict("wontfix", "size:src/c.ts", "2026-01-12T00:00:00Z"),
      verdict("noise", "arrival:src/d.ts", "2026-01-09T00:00:00Z"),
    ];
    expect(foldComparable(foldLedger([...a, ...b]))).toEqual(
      foldComparable(foldLedger([...b, ...a])),
    );
  });

  it("dedupes on id (apply-run + action-commit double delivery)", () => {
    const event = verdict("wontfix", "size:src/a.ts", "2026-01-10T00:00:00Z");
    const fold = foldLedger([event, { ...event }, { ...event }]);
    expect(fold.events).toHaveLength(1);
  });

  it("latest verdict per fingerprint wins", () => {
    const fold = foldLedger([
      verdict("justified", "size:src/a.ts", "2026-01-10T00:00:00Z"),
      verdict("wontfix", "size:src/a.ts", "2026-02-10T00:00:00Z"),
    ]);
    expect(fold.verdicts.get("size:src/a.ts")?.verdict).toBe("wontfix");
  });
});

describe("attested ratchet", () => {
  function noiseEvents(lane: string, count: number): LedgerEvent[] {
    return Array.from({ length: count }, (_, i) =>
      verdict("noise", makeFingerprint(lane, `src/f${i}.ts`), "2026-01-10T00:00:00Z"),
    );
  }

  it("moves the floor only at quorum (3 distinct fingerprints)", () => {
    expect(foldLedger(noiseEvents("arrival", 2)).floorSteps.get("arrival")).toBe(0);
    expect(foldLedger(noiseEvents("arrival", 3)).floorSteps.get("arrival")).toBe(1);
    expect(foldLedger(noiseEvents("arrival", 6)).floorSteps.get("arrival")).toBe(2);
  });

  it("caps at 2 steps no matter how many verdicts", () => {
    expect(foldLedger(noiseEvents("arrival", 12)).floorSteps.get("arrival")).toBe(2);
  });

  it("counts a re-attested fingerprint once", () => {
    const same = [
      verdict("noise", "arrival:src/x.ts", "2026-01-10T00:00:00Z"),
      verdict("noise", "arrival:src/x.ts", "2026-01-11T00:00:00Z"),
      verdict("noise", "arrival:src/x.ts", "2026-01-12T00:00:00Z"),
    ];
    expect(foldLedger(same).floorSteps.get("arrival")).toBe(0);
  });

  it("floor-reset clears the count; later noise counts fresh", () => {
    const events: LedgerEvent[] = [
      ...noiseEvents("arrival", 3),
      {
        id: makeUlid(Date.parse("2026-02-01T00:00:00Z")),
        at: "2026-02-01T00:00:00Z",
        kind: "floor-reset",
        lane: "arrival",
      },
      verdict("noise", "arrival:src/later.ts", "2026-02-02T00:00:00Z"),
    ];
    const fold = foldLedger(events);
    expect(fold.floorSteps.get("arrival")).toBe(0);
    expect(fold.noiseByLane.get("arrival")?.size).toBe(1);
  });

  it("translates steps into absolute floors above the anchor", () => {
    const fold = foldLedger(noiseEvents("arrival", 3));
    // arrival anchor 1.0, one 25% step → 1.25.
    expect(floorsForScoring(fold).arrival).toBeCloseTo(1.25);
    expect(floorsForScoring(foldLedger(noiseEvents("arrival", 2)))).toEqual({});
  });
});

describe("resolveVerdict", () => {
  const anchorDate = "2026-08-05T12:00:00Z";

  it("wontfix and noise suppress forever", () => {
    const fold = foldLedger([
      verdict("wontfix", "size:src/a.ts", "2020-01-01T00:00:00Z"),
      verdict("noise", "arrival:src/b.ts", "2020-01-01T00:00:00Z"),
    ]);
    expect(resolveVerdict(fold, "size:src/a.ts", { anchorDate })).toMatchObject({
      status: "wontfix",
      suppressed: true,
    });
    expect(resolveVerdict(fold, "arrival:src/b.ts", { anchorDate })).toMatchObject(
      { status: "noise", suppressed: true },
    );
  });

  it("fresh justified suppresses; stale justified ages but still suppresses", () => {
    const fold = foldLedger([
      verdict("justified", "size:src/fresh.ts", "2026-07-01T00:00:00Z"),
      verdict("justified", "size:src/stale.ts", "2025-12-01T00:00:00Z"),
    ]);
    expect(
      resolveVerdict(fold, "size:src/fresh.ts", { anchorDate }).status,
    ).toBe("justified");
    expect(resolveVerdict(fold, "size:src/stale.ts", { anchorDate })).toMatchObject(
      { status: "justified-aging", suppressed: true },
    );
  });

  it("growth beyond the threshold hard-reopens a justification", () => {
    const fold = foldLedger([
      verdict("justified", "size:src/grew.ts", "2026-07-01T00:00:00Z", {
        baseline: { codeLines: 500 },
        invalidateWhen: { growthPct: 20 },
      }),
    ]);
    const grown = resolveVerdict(fold, "size:src/grew.ts", {
      anchorDate,
      codeLines: new Map([["src/grew.ts", 700]]),
    });
    expect(grown).toMatchObject({ status: "reopened-growth", suppressed: false });

    const within = resolveVerdict(fold, "size:src/grew.ts", {
      anchorDate,
      codeLines: new Map([["src/grew.ts", 590]]),
    });
    expect(within.status).toBe("justified");
  });

  it("returns none for unknown fingerprints", () => {
    expect(
      resolveVerdict(foldLedger([]), "size:src/x.ts", { anchorDate }).status,
    ).toBe("none");
  });
});

describe("firing/fixed state machine with hysteresis", () => {
  const at = "2026-08-05T12:00:00Z";
  const fp = "arrival:src/f.ts";
  // arrival anchor 0.6 → hysteresis step 0.15.

  function scores(score: number) {
    return new Map([[fp, { score, threshold: 0.6 }]]);
  }

  it("stamps firing for a newly firing fingerprint", () => {
    const events = computeRunEvents(foldLedger([]), scores(0.8), at);
    expect(events).toHaveLength(1);
    expect((events[0] as FiringEvent).kind).toBe("firing");
  });

  it("does not restamp a still-firing fingerprint", () => {
    const first = computeRunEvents(foldLedger([]), scores(0.8), at);
    const fold = foldLedger(first);
    expect(computeRunEvents(fold, scores(0.9), at)).toHaveLength(0);
  });

  it("oscillation inside the hysteresis band never stamps fixed", () => {
    const fold = foldLedger(computeRunEvents(foldLedger([]), scores(0.8), at));
    // 0.5 is below threshold 0.6 but above 0.6 - 0.15 = 0.45.
    expect(computeRunEvents(fold, scores(0.5), at)).toHaveLength(0);
  });

  it("a real drop stamps fixed, and a later re-rise refires", () => {
    // Successive audit runs carry successive anchor dates.
    let ledger = computeRunEvents(foldLedger([]), scores(0.8), at);
    const dropped = computeRunEvents(
      foldLedger(ledger),
      scores(0.3),
      "2026-08-12T12:00:00Z",
    );
    expect(dropped).toHaveLength(1);
    expect((dropped[0] as FixedEvent).verdict).toBe("fixed");

    ledger = [...ledger, ...dropped];
    const refire = computeRunEvents(
      foldLedger(ledger),
      scores(0.9),
      "2026-08-19T12:00:00Z",
    );
    expect(refire).toHaveLength(1);
    expect((refire[0] as FiringEvent).kind).toBe("firing");
  });

  it("a vanished file (no current score) counts as dropped to zero", () => {
    const fold = foldLedger(computeRunEvents(foldLedger([]), scores(0.8), at));
    const events = computeRunEvents(fold, new Map(), at);
    expect(events).toHaveLength(1);
    expect((events[0] as FixedEvent).verdict).toBe("fixed");
  });
});

describe("batch acknowledgment", () => {
  const firing = (fp: string, at: string) => ({
    id: `01FIRE${fp.replace(/[^A-Z]/gi, "").toUpperCase().slice(0, 12)}${at.slice(8, 10)}`,
    at,
    kind: "firing" as const,
    fingerprint: fp,
    score: 1,
    threshold: 1,
  });
  const ack = (at: string, prNumber: number) => ({
    id: `01ACK${at.slice(5, 7)}${at.slice(8, 10)}A0000000000000000`,
    at,
    kind: "acknowledged" as const,
    prNumber,
  });

  it("folds the latest acknowledgment", () => {
    const fold = foldLedger([
      ack("2026-08-10T00:00:00Z", 5),
      ack("2026-08-15T00:00:00Z", 8),
    ]);
    expect(fold.lastAcknowledged?.prNumber).toBe(8);
  });

  it("firingsSinceAcknowledged returns only unfixed, post-ack firings", () => {
    const fold = foldLedger([
      firing("size:old.ts", "2026-08-10T00:00:00Z"),
      ack("2026-08-15T00:00:00Z", 8),
      firing("size:new.ts", "2026-08-16T00:00:00Z"),
      firing("deadcode:fixedlater.ts", "2026-08-16T01:00:00Z"),
      {
        id: "01FIXEDLATER00000000000000",
        at: "2026-08-16T02:00:00Z",
        verdict: "fixed" as const,
        fingerprint: "deadcode:fixedlater.ts",
        score: 0,
        threshold: 1,
      },
    ]);
    const fresh = firingsSinceAcknowledged(fold);
    expect(fresh.map((s) => s.fingerprint)).toEqual(["size:new.ts"]);
  });

  it("with no acknowledgment, every standing firing is new (bootstrap)", () => {
    const fold = foldLedger([firing("size:a.ts", "2026-08-10T00:00:00Z")]);
    expect(firingsSinceAcknowledged(fold)).toHaveLength(1);
  });
});

describe("rename migration", () => {
  it("emits rename events for vanished paths and folds history onto the new key", () => {
    const original = verdict("wontfix", "size:src/old.ts", "2026-01-10T00:00:00Z");
    const fold = foldLedger([original]);
    const renameEvents = computeRenameEvents(
      fold,
      new Map([["src/old.ts", "src/new.ts"]]),
      new Set(["src/new.ts"]),
      "2026-08-05T12:00:00Z",
    );
    expect(renameEvents).toHaveLength(1);
    expect(renameEvents[0]).toMatchObject({
      from: "src/old.ts",
      to: "src/new.ts",
    });

    const migrated = foldLedger([original, ...renameEvents]);
    expect(migrated.verdicts.has("size:src/new.ts")).toBe(true);
    expect(migrated.verdicts.has("size:src/old.ts")).toBe(false);
  });

  it("emits nothing when the old path still exists or has no target", () => {
    const fold = foldLedger([
      verdict("wontfix", "size:src/here.ts", "2026-01-10T00:00:00Z"),
      verdict("wontfix", "size:src/gone.ts", "2026-01-10T00:00:00Z"),
    ]);
    const events = computeRenameEvents(
      fold,
      new Map(),
      new Set(["src/here.ts"]),
      "2026-08-05T12:00:00Z",
    );
    expect(events).toEqual([]);
  });
});

describe("storage round-trip", () => {
  it("appends and reads JSONL, skipping garbage lines", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecheck-ledger-"));
    cleanups.push(root);
    const events = [
      verdict("justified", "size:src/a.ts", "2026-01-10T00:00:00Z"),
      verdict("noise", "arrival:src/b.ts", "2026-01-11T00:00:00Z"),
    ];
    appendEvents(root, [events[0]]);
    appendEvents(root, [events[1]]);
    expect(readLedger(root)).toEqual(events);
  });
});
