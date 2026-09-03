# vibeCompact — revival brief

**Written 2026-09-03, at a deliberate pause.** Everything here is verified
against the fleet on that date. If you are reading this cold, start at
"State in one minute", then read "The five open challenges" — the rest is
reference.

---

## State in one minute

vibeCompact is a deterministic six-lane code-quality audit that runs in CI
across 12 repos, delivers findings as an episodic pull request plus a living
issue, and remembers every human decision in an append-only ledger.

- **The pipeline works.** Twelve repos ran it green for two weeks straight.
- **The operators engaged seriously.** 125 verdicts with written reasons,
  418 machine-confirmed fixes, real refactors landed behind passing tests.
- **They found nine detector defects. All nine are fixed and closed** as of
  `b67d5d5`, each verified against the repo that reported it.
- **The daily schedule is currently OFF fleet-wide** (disabled 2026-08-24 —
  see challenge 1). vibeCompact today only runs on manual dispatch.
- **The unresolved problem is signal quality**, not delivery: the last
  measured batch was **59% re-surfaced noise**, and the two defects most
  responsible were never filed as issues (challenge 2).

---

## What it is (cold-start orientation)

Six lanes score every tracked file; a finding is *corroborated* only when
≥2 independent lanes fire on the same file.

| lane | signal | substrate |
|---|---|---|
| `size` | code lines vs language-adjusted tiers | scc (+ Python docstring subtraction) |
| `arrival` | share of commits that arrived with no reaching test | git history ∪ import graph |
| `deadcode` | share of exported/defined surface unconsumed | knip (TS/JS) + vulture (Python) |
| `duplication` | duplicated share of the file | jscpd |
| `smells` | `any`-density | type-coverage |
| `consistency` | copy artifacts, orphans, cycles, provider drift | in-house |

Three surfaces, three jobs, no overlap:

- **The `vibecompact/data` branch** is the canonical store (briefing,
  evidence packages, ledger, trends, `audit.json`).
- **The living issue** is the always-current dashboard.
- **The findings PR is a work batch** — it opens only when new findings
  fire, and **closing it is the acknowledgment signal**. It is never merged.

**The ledger (`.vibecompact/ledger.jsonl`) is the memory.** Verdicts, firing
and fixed stamps, batch acknowledgments. Every run reads the union of the
copy on the default branch and the copy on the data branch, deduped by ULID.

---

## Current fleet status

All twelve repos last ran green. **Schedule disabled 2026-08-24**; these are
the last scheduled runs.

| repo | last run | open findings PR | verdicts filed |
|---|---|---|---|
| hadoku_site | 08-25 | **#244** | 30 |
| hadoku-watchparty | 08-24 | — | 35 |
| hadoku-dataplatform | 08-24 | **#13** | 35 |
| hadoku-pygmalion | 08-24 | **#22** | 10 |
| hadoku-task | 08-24 | — | 6 |
| hadoku-promptsmith | 08-24 | — | 3 |
| hadoku-jobplatform | 08-24 | **#14** | 2 |
| hadoku-conjure | 08-25 | — | 2 |
| hadoku-meet | 08-24 | — | 2 |
| tenhands | 08-25 | — | 0 |
| hadoku-games-host | 08-24 | — | 0 |
| vibecheck (self) | 08-31 | **#376** | 0 |

Five findings PRs are open and unread. Three repos never engaged at all
(tenhands, games-host, vibecheck itself) — tenhands is the largest untouched
pile, ~144 standing firings.

---

## What the field actually told us

This is the most valuable asset the project has, and it was expensive to
collect. Do not re-litigate it.

### They engaged, hard

- **dataplatform** split `VodPlayer.tsx` 1385→798 into five tested modules,
  split a 2598-line stylesheet into ten files with a `cmp`-identical build,
  and filed 32 verdicts in one sitting.
- **hadoku-task** fixed 9 findings with the full Playwright suite green
  (147 passed) and left 6 firing on purpose: *"real work, not done yet."*
- **jobplatform** turned `jobs.ts` into seven modules behind 125 passing
  worker tests, with a byte-identical `dist/style.css`.
- **watchparty** caught the single worst defect in the system (see #383
  below) and refactored two files after retracting its *own* bad verdicts.
- **site** filed 30 verdicts and, along the way, found a genuine pm2
  crash-loop gap — the one that had let a service restart every 5.3s for two
  days.

### Praise worth remembering

> "all six deadcode/orphan claims were **true positives**" — jobplatform
>
> "the coverage gap, which I think is **the most valuable item here**" — watchparty
>
> "The findings themselves are fine and are being worked." — hadoku_site

### The criticism, in their words

> "A PR that is designed never to close is not a delivery channel, it is a
> **permanent alarm** … That is a real cost we are not willing to pay for a
> report." — hadoku_site

> "the detector was partly wrong about `testHarness.ts` … Of the 10 flagged
> exports, **5 *are* consumed externally**" — watchparty

> "That's a **cross-language blindness**, not 23 real findings." — dataplatform,
> on arrival firing at React components covered by 49 Python-driven
> Playwright tests

> "Deleting it would have **broken the Discord identity swap with CI staying
> green**." — promptsmith, on a convention-loaded hook flagged for deletion

### The pattern that matters most

**Three separate teams refused to file `noise` verdicts on detector defects**,
because three noise verdicts on one lane ratchet that lane's floor repo-wide.
They wrote GitHub issues instead. Our own false-positive rate was therefore
*unmeasurable by construction* — the mechanism designed to learn from noise
was teaching people not to report it. That insight drove the `detector-gap`
verdict type.

---

## What was shipped in response

Three rounds, all on `main`, all verified against the reporting repo.

**Round 1 — delivery (`11981e1`).** Episodic findings PRs. No standing PR;
closing one stamps an `acknowledged` ledger event; a new PR opens only when
firings post-date that acknowledgment. Field-verified: hadoku_site closed
#233 and the next run logged *"No new findings since the last acknowledged
batch — no PR opened."*

**Round 2 — the decision loop (`8b708dd`).**

- **Growth invalidation is lane-aware.** It had been re-opening *any*
  justified verdict when a file grew 20%, including verdicts whose reasoning
  was structural. A config file justified as *"nothing can import an eslint
  config"* was hard-reopened because it grew 72→147 lines. **51 verdicts
  across four repos were armed to do the same.**
- **Pattern verdicts.** `justify "arrival:frontend/**/*.tsx"` answers a file
  class once (dataplatform had filed 18 verbatim-identical justifications);
  `wontfix "*:path"` accepts a file on every lane, closing the escape where
  pygmalion's `wontfix` on `size:` left `arrival:` firing on the same frozen
  file. Most specific wins.
- **`detector-gap` verdict.** Suppresses like noise, **never ratchets**,
  carries a `--mechanism` class. Live-verified: nine gap verdicts on one lane
  left the floors empty.
- **`vibecheck fleet-report [dir]`.** Reads every sibling checkout's ledger
  (working tree ∪ data branch) and ranks detector claims by repos affected.
  Classifies operator self-retractions separately so we never inflate our own
  defect count with someone correcting themselves.

**Round 3 — the nine detector defects (`b67d5d5`).** Four root causes:

| issues | defect | fix | verified |
|---|---|---|---|
| #380, #386 | spans ran declaration-to-next-declaration, so route registrations and JSX returns were attributed to the preceding function; a 13-line helper claimed 777 lines | real brace-depth / indentation extents, capped at the next declaration, `approximate` flag when unbalanced | `idFrom` now reads **13 lines** on the reporting file |
| #382, #385 | vulture ran without `--ignore-decorators`, so every route handler, Click command and fixture read as dead | decorator list, framework names, tuple-unpack filter, Python test-file exemption | dataplatform raw items **142 → 55** |
| #383, #378 | type-coverage returns a *plausible wrong* percentage without `node_modules`; solution-style monorepo roots scan zero files | verify deps installed (walking up for hoisted); expand `{files:[],references:[]}` into referenced projects | watchparty root → `packages/shared`, `apps/server`, `apps/ui` |
| #384, #381, #387 | configs fire with an impossible remedy; convention-loaded plugins look like orphans; clone spans count comments | config exemption; `audit.entry_points` globs; count spans on scc's basis | unit + field verified |

329 tests, lint clean.

---

## The five open challenges

Ranked by what actually blocks value.

### 1. The fleet schedule is off, and turning it back on will break things

Disabled 2026-08-24 with this note in every workflow:

> Every repo carrying this workflow fired at the **SAME minute** (06:00 UTC)
> — a synchronised fleet-wide fan-out onto claws that each share one pnpm
> store across ~28 runner instances. That is the concurrency shape that
> corrupted the pnpm stores on claw-2 and claw-3 and took the site's CI down
> for roughly an hour. **If it is restored, give each repo a DIFFERENT
> minute** rather than putting this line back verbatim.

Until this is resolved, vibeCompact only runs on manual dispatch, and the
whole fix-confirmation loop (which depends on regular re-audits) is dormant.
**This is the first thing to fix on revival.** Stagger the minutes; consider
also whether the action's per-job pnpm install can share less state.

### 2. Two known detector defects are still unfixed — and they are the ones that fake corroboration

Neither was ever filed as an issue; they came out of my own read of the
batches.

- **NodeNext `.js` → `.ts` specifier resolution.** Consumers in
  `services/mgmt-api` import as `from '../vault-token-store.js'`. The import
  graph does not remap `.js`→`.ts`, so the entire tree reads as zero fan-in.
  This produced **four false "delete after verification" instructions against
  live, mounted, test-covered code** on hadoku_site — including
  `routes/fleet.ts`, whose router is mounted at `index.ts:145`.
  **It poisons `deadcode` and `arrival` simultaneously**, so those two lanes
  "corroborate" each other through one shared defect. Site #244's rank-1
  corroborated items are this bug.
- **Re-export chains are not followed.** `useRotate.ts` re-exports
  `RotateTier` with an inline comment explaining that consumers import it
  from there; `RotateView.tsx` does exactly that; the lane says delete it.

Fixing these two is the highest-value detector work remaining, and unlike
the previous round we can now *measure* the effect with `fleet-report`.

### 3. Signal-to-noise is still the core product problem

Last measured (four batch PRs, 73 packaged findings): **30 new / 5 repeats /
38 known-noise — 59% re-surfaced noise.** The nine fixes plus verdict v2
should have moved this substantially, but **it has not been re-measured since
those landed.** Re-running the measurement is the cheapest way to know
whether the project is working.

Structural sub-problems, both raised independently by two teams:

- **Pseudo-corroboration.** On tenhands, 14 of 15 "corroborated" offenders
  were the same arrival+smells pair on frontend files — not two independent
  signals, but two symptoms of one state (untested, loosely typed React).
  The ≥2-lane gate assumes lane independence it does not verify.
- **Abstention hides the real risk.** When a subtree has zero tests, arrival
  correctly mutes as a repo-level fact — and then the untested-ness never
  surfaces as work. Pygmalion put it best: *"a 569-line PlayView.tsx driving
  the turn loop with no safety net is a materially bigger risk than any line
  count in this briefing."* We report the noise-shaped version of the problem
  and hide the true one.

### 4. Live bad advice is still sitting in an open PR

**hadoku_site #244 recommends deleting `src/components/GamesHeader.tsx`**,
which is imported and mounted by `src/pages/games/index.astro`. That repo
already holds two `noise` verdicts explicitly naming the `.astro` blind spot.
File a `detector-gap` verdict on it (mechanism `template-mount`) before
anyone acts on it. The four other open PRs (#13, #14, #22, #376) predate the
fixes and should be regenerated rather than read.

### 5. The tool audits itself into its own issue tracker

Twelve-plus open issues on vibecheck are the *other* product (vibeCheck
analyze) filing lint and duplicate-code findings against vibeCompact's own
source — e.g. #388 "Unused code in fleet-report.ts (5 exports, 2 types)",
which are exports used only by tests. Harmless but it makes the issue list
useless for real signal. Either exclude the audit's own source from analyze
mode, or route those findings somewhere other than issues.

---

## Where to pick up — suggested order

1. **Re-measure before building anything.** Dispatch the audit on 3–4
   engaged repos (dataplatform, site, watchparty, jobplatform), then run
   `node bin/cli.js fleet-report ~/repos`. Compare the new/repeat/noise mix
   against the 30/5/38 baseline. This tells you whether rounds 1–3 worked.
2. **Fix the two unfiled resolver defects** (challenge 2). They are the
   biggest remaining false-positive source and the cause of fake
   corroboration.
3. **Restore the schedule, staggered** (challenge 1) — different minute per
   repo, so the fix-confirmation loop comes back to life.
4. **File the `detector-gap` on GamesHeader** and regenerate the four stale
   PRs.
5. **Then, and only then, consider the structural items** — lane
   independence for the corroboration gate, and promoting "this subtree has
   no tests" to a first-class finding.

---

## Operating reference

```sh
node bin/cli.js audit                      # full local run
node bin/cli.js audit --gate               # respect the activity gate (CI path)
node bin/cli.js ledger show                # verdicts, floors, firing/fixed
node bin/cli.js gate                       # would the cron re-audit now, and why
node bin/cli.js fleet-report ~/repos       # detector claims ranked across repos
node bin/cli.js skill emit                 # regenerate the agent skill

# verdicts (operator decisions)
node bin/cli.js wontfix      "<lane>:<path>" --reason "..."
node bin/cli.js justify      "<lane>:<path>" --reason "..."
node bin/cli.js noise        "<lane>:<path>" --reason "..."   # wrong for THIS file; ratchets
node bin/cli.js detector-gap "<lane>:<path>" --reason "..." --mechanism <class>

# patterns: one decision for a class, or for a file across all lanes
node bin/cli.js justify "arrival:frontend/**/*.tsx" --reason "..."
node bin/cli.js wontfix "*:src/pages/Frozen.tsx"    --reason "..."
```

Config lives in `vibecompact.json` (`vibecheck.json` still read):
`audit.exclude`, `audit.js_roots`, `audit.entry_points`, `audit.data_pr`
(`episodic` | `never`), `audit.size_tiers`, per-lane `enabled`.

---

## Landmines

- **Never diagnose fleet runners from a `/actions/runners` snapshot.**
  `hadoku-builder` is a *dynamic* label that the tier monitor strips and
  restores many times a day. `pnpm run fleet:reconcile` is the only
  authority on coverage. I filed an issue from a snapshot once; it was closed
  not-planned, and one of its asks would have caused an outage. Report queue
  starvation as a symptom with job-level `created_at → started_at`.
- **Work in a worktree, never the main checkout**, and remember the shell's
  cwd resets between tool calls — verify with `git rev-parse --abbrev-ref
  HEAD` before committing.
- **`.claude/` is gitignored**, so the harness's `grep` wrapper returns
  nothing inside `.claude/worktrees/`. Use `command grep` there.
- **A literal NUL byte** once sat in `ledger.ts` as a separator, which made
  the file "binary" to every grep and silently broke tooling. Use `|`.
- **Local runs used to delete tracked findings** (fixed in `7614b16`), and
  local runs still write `.vibecompact/` output — run them on a clone if the
  checkout matters.
- **Regenerate `tests/golden/audit-report.golden.md`** after any renderer
  change; the generator one-liner is in the report test.

---

## The one-paragraph verdict

The machinery is sound and the operators proved they will do the work when
the findings are real — 125 reasoned verdicts and 418 confirmed fixes is not
the behaviour of people ignoring a tool. What they will not tolerate is being
handed the same wrong finding twice, and the two resolver defects in
challenge 2 are the largest remaining source of exactly that. Fix those,
re-measure with `fleet-report`, and restore the staggered schedule; that
sequence is the difference between a tool people run and a tool people mute.
