# vibeCheck Audit (`mode: audit`) — Design Plan

Status: **v4.1 — FROZEN** after four review rounds · Owner: @WolffM · 2026-08-05

**Freeze rule: v5 requires M1 data.** Rounds progressed from semantic bugs
(v2) to statistical bugs (v3) to validation-of-the-validation (v4) — the
signature of a document at the limit of what review can extract. The
remaining unknowns (will the ratchet ever fire, will anyone file an event,
which channel gets answered) are reachable only through contact. Further
pre-data revision has negative expected value.

A deterministic, no-LLM audit mode for vibeCheck that scrutinizes structural
code quality and delivers a prioritized, evidence-backed report to human
maintainers. Naming: "vibe-compactor" retired. Action input: `mode: audit`.

v4.1 folds in round-4 answers: first-contact repos pulled into M2 (the
customer loop was the last open circularity), noise-rate measured against
shipped-default firing (the ratchet was censoring its own instrument),
ULID-stamped ledger events, a constants taxonomy with decision bands,
abandonment-study confound controls, the inspection protocol dissolved into
the ledger, and the segment bet named.

---

## 1. Goals

1. **Audit, don't lint.**
2. **Alarm bell, not solutions.** Fully alarm-only in v1. "Best first
   targets" is a decision-support ranking — where to look, never what to do.
3. **Precision from corroborated, independent signals** — independence
   measured against co-firing, coverage disclosed, central claims scheduled
   for falsification under banded decision rules (§4, §10.1).
4. **Decisions are durable**; engagement is never punished more than
   disengagement.
5. **The derivative is the product** — immune to calibration-induced fake
   improvement.
6. **Audits get cheaper over time.**

### Non-goals

No LLM anywhere. No style findings. No PR blocking (v1). No hand-holding.

### Who reads what

The report's reader is the human decision-maker; `audit.llm.json` ships so a
human can hand a decision they made to an agent for execution. Alarm-only
governs who decides, not who reads.

### Positioning honesty — including the segment bet (v4.1)

Hotspots/coupling: replicated prior art, tabled. Differentiation: the
decision ledger, AI-generated-code framing, free/in-repo/zero-secrets, and
the novel cheap detectors.

**The bet:** the primary segment is the vibecoding solo dev / small team on
a young agent-written repo — someone who, by revealed preference, does not
review code, and whom we are betting will read a five-minute report and run
one CLI verdict command. That bet is the product's existential risk and no
internal instrument can test it (§10.2 — first contact is an M2 exit
criterion for exactly this reason). **If the bet misses,** the fallback
customer is the tech lead adopting agent coding on a mature repo — a segment
for which the tabled hotspot lane and 12-month windows (§13) matter again.
The tabling decisions are segment-conditional and would be revisited, not
relitigated.

---

## 2. Relationship to vibeCheck

| | vibeCheck (classic) | audit mode |
|---|---|---|
| Consumer | AI coding agents (via issues) | Human maintainers (via report) |
| Findings | Mechanically true | Judgment-shaped (structural) |
| Unit | Individual finding → issue | Per-file scores → ranked report |
| Cadence | Per run / manual | Weekly runs; ~monthly trend resolution |
| Noise strategy | Severity/confidence thresholds | Coverage-aware ≥2-lane gate + absolute anchors + attested local calibration |
| Output | Issues + SARIF | One living issue (default) + artifacts |

---

## 3. Pre-pass: exclusions

Generated/vendored exclusion before any lane: `linguist-generated` /
`linguist-vendored`, `@generated` / `DO NOT EDIT` headers, path conventions
(`vendor/`, `third_party/`, `dist/`, `build/`, `node_modules/`, `*_pb2.py`,
`*.pb.go`, `*.gen.*`, `*.min.js`, lockfiles, migrations, snapshot dirs).
One appendix count. All counting uses scc **code lines**.

## 3.1 Audit lanes

All lanes emit per-file **densities**.

### Lane classes (the spine)

- **State-descriptive** — verifiable claims about current state: L1, L4-
  static, L6, L7. Validated by inspection and noise verdicts; never fitted
  on future corrective events (the neglect confound). Because state findings
  are inspectable by definition, inspection — not outcomes — is their
  validation instrument wherever the backtest can't reach.
- **Outcome-predictive** — "this will hurt you": L3, L5, L2. The backtest's
  jurisdiction.

### L1 · Dead code — state

knip / Vulture ∪ Skylos (both-flagged = medium; correlated blindness) /
clippy / PMD-private; deps via knip, deptry, cargo-shear, DepClean.
Dead-LOC share, confidence-weighted. Alarm-only in v1; deletion-candidate
spec dormant in §13 with gate-pass counting.

### L2 · Duplication — outcome

jscpd v5 (min ~30 lines), similarity-ts (TS/JS semantic), PMD CPD
`--ignore-identifiers`. Duplicated share + cluster fan-out; evidence notes
existing `utils/` overlap.

### L3 · Arrival forensics — outcome; in-house

- **Test co-change (primary), graph-joined:** share of commits touching F
  that touched no test file *whose static import path reaches F* (L4's
  test-path graph; current graph approximates history — disclosed).
  **Bias direction (v4.1):** the approximation is anachronistic in both
  directions on old repos but *nearly exact on young repos* — young-repo
  mode's confidence line claims the stronger version. Where the graph is
  unavailable, squash detection demotes stated confidence.
- **Bulk arrival (secondary):** arrival concentration normalized against
  the repo's own commit-shape baseline — principled carve-out from the
  no-curve rule (workflow is a confounder, not quality). Uniform squash ⇒
  variance collapse ⇒ auto-mute, disclosed.
- **Snapshot churn:** `.snap`/golden edits in commits touching no test
  logic.
- Determinism: window anchored to audit HEAD's commit date. Commit shape,
  never authorship identity.

### L4 · Test quality — state (static tier)

Assertion-free / disabled / snapshot-only tests; mock-of-unit-under-test
(`requireActual` / `importOriginal` partial mocks = NOT mocked); **no
static test path** (exactly those words; e2e/DI detection demotes
confidence). Builds the test-path graph for L3. Dynamic tier (opt-in):
coverage; diff-scoped mutation; degrades without failing.

### L5 · Size & complexity — outcome

scc code lines, lizard CCN, cognitive complexity where free. Tier
thresholds **language-adjusted by hand-set multipliers** (v4.1: explicitly
hand-set — the v2 phrase "from the reference corpus" referenced a mechanism
§13 later deleted; no dangling dependency). Uniform ledger treatment;
Tier-3 firmness lives in report framing. Cohesion modifier.

### L6 · Structural smells — state

ast-grep rulepack + type-coverage + cross-file joins. Per-KLOC,
low-weighted.

### L7 · Consistency & redundant infrastructure — state

- **Multiple implementations of one concern**, scoped per package: unit =
  **import sites per package** (declarations under-count under hoisting;
  node_modules resolution over-counts). Within-package fires; across-
  packages is a context line, never an offender. Package map from shared
  repo-detection; L7 consumes, doesn't build.
- **Category table:** curated, capped at 10.
- **Copy artifacts require the unsuffixed sibling to coexist**
  (`utils.ts` + `utils_v2.ts` fires; lone `api_v2/` doesn't). Same-basename
  clustering **excludes barrel/entry conventions** (v4.1): `index.*`,
  `mod.rs`, `__init__.py`, `main.*` — otherwise every barrel file in the
  repo flags.
- Import cycles & layering; **orphaned files** at headline billing.

---

## 4. Scoring & corroboration

### The rule

> **Nothing enters "worst offenders" without at least two applicable lanes
> firing.**

**Coverage-aware, bias disclosed:** ≥2 of the lanes applicable to the file.
Known distortion: well-tooled languages clear the gate combinatorially more
easily; polyglot worst-offender lists overrepresent them. Every finding
records its applicable-lane count; confidence basis states cross-language
ranks aren't apples-to-apples; coverage-weighted ranking awaits backtest
evidence.

**No-override falsification — scoped, banded (v4.1):**

- *Outcome lanes:* corrective-event lift of top-decile single-lane files
  vs. size-matched controls, binding at M3, under the banded decision rule
  of §10.1 (no point thresholds).
- *State lanes:* inspection (sample sizes set by §10.1 power analysis, not
  declared), same banded structure. Post-dogfood, the protocol continues as
  field data (§10.2).

### Mechanics

1. Scores = densities through **hand-set absolute anchors**.
2. **Firing** = score ≥ max(lane floor, anchor), as adjusted by the
   attested ratchet.
3. **Worst offenders** = gate-passing files ranked by weighted sum of
   firing lane scores. Entry threshold before cap; 15 is a ceiling. Rank +
   evidence in the report; numbers in the appendix.
4. **Best first targets:** gate-passing × low blast radius.

### Calibration authorities — one job each

- **Anchors own firing.** Hand-set globally; bent per-repo only by the
  attested ratchet. **Cross-repo anchor refinement consumes only
  pre-ratchet firing data** (v4.1 — see §12: post-ratchet data is censored
  by construction; every ratcheted repo has already stopped reporting its
  disagreements).
- **The backtest owns ordering.** Never sets firing, never touches state
  lanes.

**The no-curve rule, honest version:** silent statistical self-
normalization is forbidden; the ratchet is within-repo calibration and is
acceptable because it is explicit, human-attested, quorum-gated, capped,
printed in every report, and reversible. Curves may not set themselves;
maintainers may bend them on the record.

### Independence (co-firing measures)

Zero-inflated densities make all-files rank correlation read artificially
low. Per lane pair, binding at M3: **firing-set Jaccard ≤ 0.5** and
**conditional Spearman ≤ 0.6** (files where ≥1 of the pair is nonzero).
M1 numbers provisional. L5 violations ⇒ residualize against code-LOC.

---

## 5. Decision ledger

### Storage: append-only event log

`.vibecheck/ledger.jsonl`; verdicts derived by fold. **Every event carries
a ULID assigned at write time (v4.1); the fold orders by `(at, id)` and
dedupes on `id`** — a total order, deterministic across any merge history.
Dedup is independently necessary: `apply-run` on a laptop plus the same
run's events landing via a later action commit is a realistic duplicate
path, and union merge happily concatenates. (Vector clocks solve a
causality problem human-action events don't have; simultaneity deserves an
arbitrary-but-deterministic tiebreak, which the ULID is.)

Merges need `.gitattributes: .vibecheck/ledger.jsonl merge=union` — shipped
**in the starter workflow's setup PR** (v4.1), not installed by the action:
a first-run bot commit to the default branch is the exact write branch
protection rejects.

No materialized `ledger.json` in-repo; `vibecheck ledger show` prints the
fold.

```json
{"id":"01J4QZ0N9GVX...","at":"2026-08-05","fingerprint":"large-file:src/utils/fingerprints.ts","verdict":"justified","reason":"Single cohesive hashing module","baseline":{"codeLines":610,"sha":"7808796"},"invalidateWhen":{"growthPct":20,"maxAgeDays":180}}
```

### Verdicts — uniform across tiers

- `justified` — not a problem, with reason. Growth invalidation = hard
  re-open. Age expiry (180d) = refresh-and-quote: appears as an *aging
  justification* to re-affirm via one CLI call, never re-opened as an
  offender.
- `wontfix` — real, accepted, with reason. Forever, all tiers; one
  accepted-debt line.
- `noise` — the finding was wrong. Attested ratchet: floor moves only
  after ≥3 distinct verdicts (behavioral constant, §10.1), one quantized
  step, capped at 2; reversible by `vibecheck floors reset <lane>`; never
  time-decayed; standing floors printed every audit; **floor changes emit
  trend-break flags** identical to tool upgrades.
- `fixed` — auto-stamped only when the raw score dropped below the original
  firing level **minus one quantization step (v4.1: hysteresis)** — files
  oscillating at the threshold must not flap fixed/refired. Findings
  suppressed by a raised floor get `suppressed-by-floor`, excluded from
  trend improvements.

### CLI semantics

`npx vibecheck justify|wontfix|noise <fingerprint> --reason "..."` appends
+ commits locally; pushes only with `--push`. `vibecheck apply-run
<run-id>` applies a run's events from a workflow artifact.

### Renames

Stats run `--no-renames`; a rename-detection pass migrates ledger keys.
±20-line smell bucketing: >20-line shifts re-nag once — accepted; widening
buckets risks suppressing the wrong finding.

---

## 6. Report & delivery

### Channel: issue, decided on operational grounds

One living issue, edited in place. No stale-PR bots, no force-push
orphaning threads, no branch-protection interaction. Entry-rate data across
channels is recorded but acknowledged confounded (self-selection); only a
dramatic documented dogfood difference overturns the default.
`report_channel: pr` remains available, costs documented. Acknowledgment =
first ledger event.

### Data-file commits

Action commits `ledger.jsonl` + `trends.json` to the default branch with
fetch-rebase-retry. On push rejection (branch protection): events attach as
a workflow artifact; report prints "apply with `npx vibecheck apply-run
<run-id>`." No data-file PR mode.

### Report structure

1. **Health summary — derivative first**, calibration-immune
   (trend-breaks on floors; `suppressed-by-floor` never counts as
   improvement).
2. **Worst offenders** (threshold-gated, ≤15) with applicable-lane counts.
3. **Best first targets** (≤5).
4. **Lane summaries** with confidence basis: per-language lane coverage,
   auto-muted signals, graph-approximation disclosure (stronger claim in
   young-repo mode), rank-comparability caveat.
5. **Ledger activity**: verdicts, aging justifications, standing floors,
   suppressed-by-floor count.
6. Artifact links.

### Cadence, determinism, young-repo mode

Weekly runs; trend section compares against the last audit ≥21 days old.
Tool versions + anchor SHA recorded; trend deltas spanning a tool upgrade
or floor change are flagged. Young-repo mode (history < 90 days or < 200
commits — the expected default customer): weights shift toward
L1/L2/L7/no-static-test-path; graph-joined co-change primary with the
near-exact-graph confidence claim; bulk arrival self-mutes.

---

## 7. Scheduling & incrementality

Cron weekly + dispatch; activity gate exits in seconds when quiet;
`fetch-depth: 0` wanted, shallow soft-fails to young-repo mode; ledger fold
prevents re-reporting; caches via actions/cache.

---

## 8. Customer delivery

`uses: WolffM/vibecheck@main`, `mode: audit`, zero new secrets.
Permissions: `contents: write`, `issues: write` (+ `pull-requests: write`
only for `report_channel: pr`).

```yaml
audit:
  enabled: true
  dynamic_tests: false
  report_channel: issue     # issue | pr
  max_report_items: 15
  size_tiers: [500, 1000, 2000]   # code lines, hand-set language multipliers
  lanes:
    duplication: { min_lines: 30 }
    consistency: { enabled: true }
```

---

## 9. Architecture

```
src/audit/
  index.ts            # orchestration, activity gate, young-repo detection
  exclusions.ts
  git-arrival.ts      # graph-joined co-change, bulk arrival, snapshot churn
  lanes/              # dead-code, duplication, arrival, tests, size,
                      # smells, consistency
  scoring.ts          # anchors, floors, coverage-aware gate, rankings
  ledger.ts           # JSONL events (ULID), fold, ratchet, rename migration
  report.ts           # issue/PR render, trends.json
  backtest.ts         # §10 harness + inspection sampler + anchor perturbation
  rules/              # ast-grep rulepack
```

Package map from shared repo-detection. New runners join the existing
registry, pinned + soft-fail.

---

## 10. Validation

**Jurisdiction: outcome-predictive lanes and ranking only.** State lanes:
inspection + noise verdicts; exempt from outcome fitting (neglect
confound).

Backtest: audit at HEAD−N months; label the following N months (deleted,
rewritten >50%, split, heavily patched; neglect-class confirming label for
state-lane sanity only). Size-matched controls everywhere. Young epochs in
both fit and validation sets, rewrites/splits as primary young-repo labels.
Anti-tautology rule for any resurrected forensics lane.

**Survivorship bias, named:** backtestable young repos are young epochs of
*survivor* repos; abandoned repos never enter the file-level sample.
Partial remedy — **abandonment as a repo-level outcome (design per
round 4):**

- *Collapsed ≠ finished:* death = no commits in 120 days ∧ untouched open
  issues/PRs ∧ not archived, measured at month 8–10. Done-and-stable is a
  survivor.
- *The cadence confound is the study:* month-2 score correlates with
  month-2 activity, and activity trivially predicts survival. The claim is
  only "score adds signal **beyond** commit cadence": cohorts matched on
  age, size, and commit cadence; death rates compared across audit-score
  quartiles *within* cohort. Without the cadence match, the headline is
  "busy repos stay busy" wearing our logo.
- *Pre-registration:* a dated `ANALYSIS-PLAN.md` committed to this repo
  before the harvest, hash-anchored — zero-infrastructure, verifiable by
  anyone.
- *Base rate always reported next to any lift.* "Predicts repo death"
  against a 70% base rate is a different sentence than against 20%; the
  marketing survives only with the denominator in the footnote.

### 10.1 Constants taxonomy (v4.1 — replaces the flat constants list)

- **Analytic constants** (falsification n, inspection sample size):
  **derived, not declared** — simulate to a target confidence-interval
  width before M1 runs. The previously declared values were underpowered
  for their own thresholds (lift CI at n=50 spans 1.5×; binomial n=20,
  p≈0.7 is ±20 points — a coin flip dressed as a decision rule).
  **Every pre-registered decision uses bands, not points:** override above
  the upper band, demote below the lower, *no decision + corner recorded
  untested* in between.
- **Behavioral constants** (quorum 3, cap 2): declared and revisited with
  field data. Dogfood cannot exercise them — we will not generate enough
  noise verdicts on our own repos to observe quorum dynamics; an M1
  "sensitivity check" would be sensitivity to noise about noise.
- **Threshold constants** (the anchors): the check that matters is
  **ordering robustness** — perturb each anchor ±1 step and confirm
  worst-offender ordering is stable, since rank-not-scores is what the
  report design depends on. Part of M1 exit.

### 10.2 The customer loop (v4.1 — the last open circuit)

Every internal instrument validates precision, independence, ordering, or
calibration integrity. None can test the existential assumption: that the
target maintainer will read the report and file a verdict. The v4 plan
could not obtain that bit before M5 (binding M3 decisions wanted "early
customers" who don't exist until M5 productizes — the same genus of error
as the instruments this doc keeps fixing: a metric with no data path to its
subject until after the decisions it informs). Therefore:

- **M2 includes first contact: 2–3 friendly external repos** (design
  partners), onboarded before detector breadth completes. The one bit
  needed: *does anyone file a ledger event unprompted.*
- **Post-dogfood, the inspection protocol's operator is: formally nobody;
  empirically the ledger.** State-lane single-fire extremes surface in
  lane-summary top slots; maintainer verdicts on those findings *are*
  inspections — voluntary, recorded in the instrument we already read. No
  customer-facing ritual is ever built; that would conscript customers
  into our validation and invert the engagement thesis.

---

## 11. Milestones

- **M1 — the loop + the epistemics (in-house only):** exclusions, arrival
  forensics (graph-joined co-change), size lane, coverage-aware gate, JSONL
  ledger (ULID) + CLI verbs + ratchet + `apply-run`, issue channel (+pr
  option), trends.json, backtest harness, **§10.1 power simulations +
  anchor perturbation check** as exit criteria. Dogfood on vibecheck
  itself.
- **M2 — detector breadth + first contact:** lizard, ast-grep rulepack,
  type-coverage, similarity-ts, skylos, deptry, cargo-shear; dead-code /
  duplication / smells / consistency lanes; **2–3 design-partner repos
  live; exit criterion: at least one unprompted ledger event, or a
  documented pivot conversation about the segment bet (§1).**
- **M3 — test-quality static tier + binding decisions:** weights fitted
  (≥5 repos, held-out), independence gates, banded no-override decision,
  deletion-candidate go/no-go, channel default reviewed.
- **M4 — dynamic tier (opt-in).**
- **M5 — productize** (+ abandonment study if corpus ready; ANALYSIS-PLAN
  committed first).

---

## 12. Success criteria (instrumented, coupled, censoring-proof)

- **Precision instrument = the pair:** noise rate <20% within two audits,
  reported only conditional on engagement (median time-to-first-ledger-
  event < 2 cycles). Neither alone; abandonment must fail loudly.
- **Noise rate is computed against shipped-default (pre-ratchet) firing**
  (v4.1): floors are known, so the counterfactual finding set is computable
  — run the fold, score both. Post-ratchet noise rate is a UX number;
  pre-ratchet is the tuning number. Without this split, a repo that
  ratchets two lanes mechanically shows improving noise, and the metric
  certifies post-personalization precision instead of the shipped defaults
  we actually tune. Cross-repo anchor refinement likewise consumes only
  pre-ratchet data (§4).
- **Scope honesty:** dogfood + design partners + public/opt-in ledgers; no
  telemetry.
- **Backtest lift:** ≥2× corrective events vs. size-matched controls,
  held-out, outcome lanes only, banded per §10.1.
- **Independence:** Jaccard ≤0.5 ∧ conditional Spearman ≤0.6, binding M3.
- **First contact:** ≥1 unprompted ledger event from a design partner by
  M2 exit.
- Report <5 min; audit <10 min CI; unchanged repo ~0; derivative moves by
  audit #2.

---

## 13. Tabled / deferred (with reasons)

- **Churn / hotspot / coupling forensics** — segment-conditional tabling
  (§1): needs windows and message quality the *primary* segment lacks;
  L5-shared inputs; replicated prior art. Un-tables if the segment bet
  misses and the mature-repo fallback becomes primary.
- **Fix-commit classification** (depends on above).
- **Deletion candidates** — v1 counts would-have-passed gates; M3 decides.
  Spec: not-public-surface ∧ not-published-library ∧ dynamic-dispatch
  clean ∧ L4 clean; CI-green necessary, never sufficient.
- **Reference-corpus normalization** — no neutral corpus for "normal."
  (Outcome harvesting separately allowed — §10.)
- **Coverage-weighted ranking** — awaits backtest evidence.
- **`commit_mode: pr`** — `apply-run` is the branch-protection floor;
  demand would be the missing evidence.
- **PR-comment commands** — CLI first.
- **Authorship attribution** — commit shape only.
- **Agent-facing report formatting** — after the human loop is proven.

---

*Frozen 2026-08-05. Revisions to this document require M1 dogfood data,
M2 first-contact data, or a documented segment-bet pivot. Constants marked
analytic are set by the §10.1 simulations, not by edits here.*
