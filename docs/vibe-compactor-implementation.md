# vibe-compactor — M1 Implementation Plan

Companion to `docs/vibe-compactor-plan.md` (design, **v0.1 LOCKED** — read
it first; this doc says *how/in what order*, that doc says *what/why* and
wins on any conflict). Scope here is **M1 only**: the loop + the
epistemics, in-house code only, CLI-first. M2+ items are listed at the
bottom as explicit non-goals so they don't creep in.

## Context for a fresh session

- Repo: `github.com/WolffM/vibecheck` (renamed from `vibecop`; the local
  clone at `~/repos/vibecop` still points at the old remote name — pushes
  redirect fine). TypeScript, pnpm, vitest, tsx. `pnpm lint` runs with
  `--max-warnings=0`; `pnpm typecheck`; `pnpm test`. CI runs all three on
  push to main.
- **Do not work in the main checkout** (it has stale CRLF-noise
  modifications); use a worktree:
  `git worktree add .claude/worktrees/<task> -b <branch>` and integrate to
  `origin/main` via rebase + `git push origin HEAD:main`. Remote main moves
  (other agents/PRs land); always fetch + rebase before pushing.
- Existing machinery to reuse, not reinvent:
  - `src/tools/tool-registry.ts` — tool definitions with `detector`,
    `run`, `configKey`, and soft-skip via `isToolAvailable`
    (`src/tools/tool-utils.ts`). The opengrep runner
    (`src/tools/runners/security.ts`) is the model for "external binary +
    graceful skip + env-var config."
  - `src/utils/fingerprints.ts` — fingerprint scheme (tool/rule/path/
    line-bucket). Audit ledger keys build on this.
  - `src/core/repo-detect.ts` — language/monorepo detection; the audit's
    package map and young-repo detection belong here.
  - `src/core/config-loader.ts` — note: YAML parsing is a stub (JSON
    config works). The `audit:` config block should be JSON-first; don't
    build a YAML parser as a side quest.
  - `bin/cli.js` + `src/core/analyze.ts` — CLI entry pattern.
- Design doc sections most load-bearing for M1: §3 (exclusions), §3.1-L3
  (arrival), §4 (gate/scoring), §5 (ledger), §6 (report/sinks), §10.1
  (constants), §11 (M1 definition).

## Build order

Fourteen tasks, dependency-ordered. Each lands as a small PR-sized commit
train on main with tests; every task leaves `lint`/`typecheck`/`test`
green. Suggested module root: `src/audit/`.

### T1 — Scaffold + config

`src/audit/index.ts` (orchestrator skeleton), `audit` subcommand wired into
the CLI, `audit:` config block (JSON) with defaults from design §8.
**Accept:** `npx vibecheck audit --help` works; running it on vibecheck
prints a stub summary and exits 0.

### T2 — Exclusion pre-pass (`exclusions.ts`)

Design §3: linguist-generated/vendored gitattributes, `@generated`/`DO NOT
EDIT` headers (first 5 lines), path-convention list. Emits the excluded
set + count.
**Accept:** unit tests with fixture files for each rule; vibecheck's own
`dist/`-style paths excluded; count surfaces in the stub summary.

### T3 — scc runner + size lane (`lanes/size.ts`)

scc as a registry-pattern runner (pinned version, JSON output, soft-skip).
Code-lines per file, tier assignment with hand-set language multipliers,
cohesion modifier stubbed (returns neutral) — the modifier is real code in
M2.
**Accept:** per-file `{codeLines, tier, score}` for the repo; fixture test
with known file sizes; missing-scc path degrades with disclosure.

### T4 — Numstat substrate (`git-arrival.ts` part 1)

One parse of `git log --no-renames --numstat` anchored to HEAD's commit
date (design: determinism). Produces per-file commit lists with sizes,
dates, test-file flags. Squash-workflow detector (merge-commit share, PR
patterns). Young-repo detector (<90 days ∨ <200 commits) lives in
repo-detect and is consumed here.
**Accept:** same SHA → byte-identical output (determinism test); parser
fixture built from a scripted throwaway git repo in tests.

### T5 — Arrival lane (`lanes/arrival.ts` + `git-arrival.ts` part 2)

Test co-change (commit-granularity first), bulk arrival (normalized
against repo commit-shape baseline; auto-mute on variance collapse),
snapshot churn. **Graph join, M1 scope decision:** TS/JS only, using a
lightweight import-resolution walk from test files (test globs →
transitive imports); other languages ship commit-granularity + confidence
demotion, per design §3.1-L3's fallback. Full multi-language graph is
L4/M3.
**Accept:** on the scripted fixture repo, a file whose commits never
co-touch a reaching test scores high; squash fixture mutes bulk arrival
and the mute is visible in output.

### T6 — Scoring + gate (`scoring.ts`)

Hand-set anchors (documented per lane in-code), floors, firing =
max(floor, anchor), coverage-aware ≥2-applicable-lanes gate,
applicable-lane count recorded per file, weighted-sum ranking, entry
threshold, best-first-targets ranking (blast radius = codeLines + import
fan-in).
**Accept:** synthetic-matrix unit tests: single-lane extreme never enters
worst offenders; two-quiet-lanes file outranks one-loud-lane file;
thin-coverage file's applicable count recorded.

### T7 — Ledger (`ledger.ts`)

JSONL events with ULID (`ulid` package or 26-char inline impl — no heavy
deps), fold ordered by `(at, id)` deduped on `id`, verdicts
justified/wontfix/noise/fixed per design §5 (fixed-with-hysteresis,
suppressed-by-floor disposition), growth/age invalidation with
refresh-and-quote, the attested ratchet (quorum 3, cap 2, floor events in
the log itself), rename-migration pass.
**Accept:** property-style tests — fold(concat(A,B)) ==
fold(concat(B,A)) after union-merge simulation; duplicate-id dedup;
ratchet fires only at quorum; hysteresis prevents fixed/refired flap.

### T8 — CLI verbs

`vibecheck justify|wontfix|noise <fingerprint> --reason` (append + local
commit, push only with `--push`), `vibecheck ledger show` (printed fold),
`vibecheck floors reset <lane>`, `vibecheck apply-run <run-id>` (reads an
events file; the artifact-download half arrives with the action wiring in
T12).
**Accept:** integration test in a temp git repo: file a verdict, re-run
audit, finding is suppressed and appears in ledger-activity.

### T9 — Trends (`trends.json`)

Per-run entries (SHA, date, tool versions, per-lane aggregates, dirty
flag). Derivative computation comparing against last clean entry ≥21 days
old; trend-break flags on tool-version and floor changes;
suppressed-by-floor excluded from improvements.
**Accept:** unit tests for the ≥21-day selection, dirty-entry exclusion,
and a floor-change producing a flagged (not silently absorbed) delta.

### T10 — Report render + local sink (`report.ts`, `publish/local.ts`)

Markdown per design §6 structure: derivative-first health summary, worst
offenders (rank + evidence, no floats), best-first targets, lane summaries
with confidence basis (lane coverage, muted signals, young-repo claims),
ledger activity (verdicts, aging justifications, standing floors),
artifact/appendix pointers. Writes `.vibecheck/audit.md` +
`.vibecheck/out/*`; gitignore lines documented for the starter setup.
**Accept:** golden-file test of a full render from fixture data; run on
vibecheck itself reads coherently (human check).

### T11 — First dogfood + calibration pass

Run end-to-end on vibecheck and 1–2 other WolffM repos. Anchor
perturbation check (±1 step → worst-offender ordering stable) as a script
in `backtest.ts`'s module. Record provisional Jaccard + conditional
Spearman. Tune anchors only via documented in-code constants.
**Accept:** committed `docs/audit-m1-notes.md` with the numbers + a copy
of the first real audit.md. This is the M1 evidence the design doc's lock
rule feeds on.

### T12 — GitHub sinks + action wiring (`publish/github.ts`)

Last, per design: living-issue sink (create-or-edit by marker), data-file
commit with fetch-rebase-retry, push-rejection → artifact + apply-run
message, `mode: audit` input in `action.yml` (install pinned scc → run
CLI → publish), activity gate as the action's first step (CI-only; local
always runs).
**Accept:** dispatch run on vibecheck produces/updates the audit issue;
branch-protection path exercised on a test repo.

### T13 — Backtest harness (`backtest.ts`)

Audit at HEAD−N months (worktree checkout), outcome labels (deleted,
rewritten >50%, split, heavily patched; neglect-class confirming label),
size-matched controls, lift computation. Dev CLI only — not part of the
shipped audit run.
**Accept:** runs against vibecheck's own history (~2 years available);
produces a lift table; tautology guard tests.

### T14 — §10.1 power simulations

Script (can live in `scripts/`): simulate lift CIs and binomial widths at
candidate n's → emit the derived analytic constants (falsification n,
inspection sample size) and the decision bands. Update the design doc's
§10.1 values via its own amendment rule (M1 data unlocks it).
**Accept:** committed simulation script + one-page results in
`docs/audit-m1-notes.md`.

## Testing strategy

- Unit: vitest, alongside existing `tests/`. Scripted throwaway git repos
  (created in test setup via `git init` in tmp) are the fixture mechanism
  for T4/T5/T7/T8 — no committed binary fixtures.
- Determinism is a first-class test target: same SHA twice → identical
  audit.md byte-for-byte (modulo tool-version line).
- Golden files for report rendering.
- Every external binary (scc only, in M1) has an explicit missing-binary
  test asserting graceful degradation + disclosure.

## Explicit M1 non-goals (do not build)

Detector runners beyond scc (lizard, ast-grep, type-coverage,
similarity-ts, skylos, deptry, cargo-shear — M2). Dead-code / duplication
/ smells / consistency / test-quality lanes (M2/M3). Deletion candidates
(counters only, and even those are M2). Dynamic test tier (M4). PR report
channel polish beyond the config option existing. Abandonment study (M5).
Reference-corpus anything (rejected in design §13). YAML config parsing.

## Definition of M1 done

`npx vibecheck audit` on a fresh clone of vibecheck produces a coherent
`.vibecheck/audit.md` with size + arrival lanes, a working ledger loop
(verdict → suppression → ledger-activity), trends with a derivative
headline, the audit issue publishing from CI, and `audit-m1-notes.md`
containing: perturbation result, provisional independence numbers,
backtest lift table, derived analytic constants. That file is the key that
unlocks design-doc revisions.
