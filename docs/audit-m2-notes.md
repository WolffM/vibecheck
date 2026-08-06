# vibeCheck Audit — M2 evidence notes

Companion to `docs/audit-m1-notes.md`. M2 per design §11 = detector
breadth + first contact. This file records the detector-breadth evidence;
the first-contact exit criterion (one unprompted ledger event from a
design-partner repo, or a documented segment-bet pivot) is an open field
experiment, not something this file can close.

Date: 2026-08-05. All numbers provisional; independence gates bind M3.

## 1. What shipped

Four new lanes join size + arrival behind the same ≥2-applicable-lane
gate:

| lane | class | detector | anchor (weight) |
|---|---|---|---|
| L1 dead code | state | knip (TS/JS) + vulture (Python, single-source demoted ×0.6) | 0.5 (1.0) |
| L2 duplication | outcome | jscpd, min block 30 lines, interval-merged shares | 0.3 (1.0) |
| L6 smells | state | type-coverage any-density (TS) | 0.5 (0.5, low-weighted) |
| L7 consistency | state | in-house: copy artifacts, orphans, cycles, category table | 0.7 (1.0) |

Guards that earned their keep in dogfood:
- knip whole-file claims auto-mute above a 30% share of ≥10 TS/JS
  candidates (entry-point detection failure mode, seen live on vibecheck
  itself before its knip.json gained the spawned-entry list).
- The size lane skips data/markup languages — before that fix, one
  repo's offender list was entirely JSON blueprint files.
- Fixture dirs (`fixtures/`, `test-fixtures/`, `__fixtures__/`,
  `testdata/`) joined the exclusion pre-pass; vibecheck's own offender
  had been a deliberately-broken fixture.
- `audit.exclude` config: user-attested path prefixes for vendored trees
  conventions miss (reason `config`, counted in the appendix).

## 2. Firing rates at shipped anchors (4 repos)

| lane | vibecheck | hadoku_site | hadoku-task | hadoku-conjure |
|---|---|---|---|---|
| size | 2/101 | 24/556 | 13/251 | 220/1811 |
| arrival | 13/34 | 179/237 | 85/110 | 37/37 |
| deadcode | 10/100 | 9/517 | 9/209 | 45/1742 |
| duplication | 0/101 | 17/556 | 2/251 | 95/1811 |
| smells | 4/97 | n/a (JS repos skip) | n/a | n/a |
| consistency | 1/77 | 35/439 | 3/179 | 33/1637 |

New lanes fire on 0.5–5% of applicable files — the alarm-bell profile
the design wants. Arrival remains the saturated lane (segment property,
M1 notes §2); its discrimination waits on L4's real test graph (M3).

## 3. Independence (pairwise, provisional)

- Firing-set Jaccard ≤ 0.11 across all 15 lane pairs on all four repos
  (gate ≤ 0.5) — lanes flag substantially disjoint files.
- Conditional Spearman within gate (≤ 0.6) everywhere except the known
  arrival×size 0.65 on hadoku-conjure (n=37, recorded since M1).
- Several strongly *negative* correlations (deadcode×smells −0.72,
  consistency×deadcode −0.87 on one repo) — anti-correlated lanes, no
  gate concern, noted as curiosities.

## 4. Anchor perturbation (±25%, all six lanes)

Set membership is robust: typically 14–15/15 offenders retained under
any single-anchor perturbation; the arrival ceiling fragility from M1
persists (×1.25 empties the lane on saturated repos). **Fine-grained
mid-list ordering is not stable** on the larger repos — near-tied
weighted sums swap neighbors when any anchor moves. The report's
rank-based presentation survives (top entries stay top); a stricter
top-5-order criterion should replace whole-list order at M3.

## 5. Live findings worth reading (dogfood-as-first-contact)

- hadoku_site: `templates/*/validate-template.mjs` ×4 — duplicated
  scaffolding by design; textbook `wontfix` candidates for the verdict
  loop.
- hadoku-conjure: offender list is dominated by
  `backend/custom_nodes/**` (vendored ComfyUI plugins). One line of
  config clears it: `{"audit": {"exclude": ["backend/custom_nodes"]}}`.
- hadoku-task: `themes/dev/editor.js`, `src/api/client.ts`,
  `src/domain/handlers/handlers.ts` — multi-lane corroborated, plausible
  real targets.

## 6. M2 backlog (disclosed in-report where relevant)

Skylos (vulture union), deptry, cargo-shear (dep-level dead code),
similarity-ts (semantic duplication), ast-grep rulepack + cross-file
joins (L6 beyond type-coverage), lizard CCN, the size lane's cohesion
modifier (still neutral), Python/Rust category tables for L7.
