# vibeCompact

Anchor: `0123456789ab` (2026-08-05)

## Health

Since 2026-07-01 (35 days): +1 worst offenders, size firing +1.
1 finding newly suppressed by raised floors — not counted as improvement.
> ⚠ Trend break — floor: arrival 0 → 0.75. Deltas across this change are not comparable.

Current stock: 2 worst offenders, 2 gate-passing, 3 candidate files.

## Worst offenders

Entry requires ≥2 applicable lanes firing plus margin; 15 is a ceiling, not a quota.

1. `src/dumped.ts` — firing: arrival + size (2 lanes applicable)
   1483 code lines (tier 2); 79% of 14 commits arrived with no reaching test; largest single-commit arrival 12× the repo's median commit; **improving** — size score down 18% since first flagged
   Full evidence package: `.vibecompact/findings/src__dumped.ts.md`
2. `src/app.ts` — firing: arrival + size (2 lanes applicable)
   640 code lines (tier 1); 67% of 9 commits arrived with no reaching test; snapshot churn in 11% of touches
   Full evidence package: `.vibecompact/findings/src__app.ts.md`

## Best first targets

Gate-passing files with the smallest blast radius — real findings a maintainer can safely start on.

- `src/app.ts` — 640 code lines (tier 1); 67% of 9 commits arrived with no reaching test; snapshot churn in 11% of touches

## Lane summaries

### Size & complexity (L5)

3 files measured (scc 3.7.0); firing: 2. Tiers: 1 investigate / 1 heavily scrutinized / 0 no justification.

### Arrival forensics (L3)

2 files with enough history to judge; firing: 2.

Confidence basis:
- test co-change: 2 files graph-joined, 1 on commit granularity (demoted confidence)
- young repo: current import graph is near-exact for this history

## Ledger activity

Standing floors (attested ratchet, reversible via `vibecheck floors reset <lane>`): arrival at 0.75.

Suppressed by verdicts: 1 wontfix.

1 finding suppressed by raised floors (never counted as improvement).

Reopened by growth invalidation:
- `size:src/grew.ts`

Aging justifications — re-affirm with `vibecheck justify <fingerprint> --reason ...`:
- `size:src/hashing.ts` (2026-01-15): "Single cohesive hashing module"

## Appendix

- Excluded as generated/vendored: 1 file.
- JS/TS project roots (knip/type-coverage cwd): `.`.
- Declared entry points detected (exempt from orphan/dead-surface claims): 2.
- Lanes planned: size, arrival.
- Machine-readable results: `.vibecompact/out/audit.json`.
- File verdicts: `vibecheck justify|wontfix|noise <lane>:<path> --reason "..."`.
