# vibeCheck: features

## Static analysis and issues

The default mode (`mode: analyze` in `action.yml`, the default). On a run,
vibeCheck detects the repo's languages and monorepo shape, then runs the
matching tools: Trunk (which wraps ESLint and others), `tsc`, `jscpd`,
dependency-cruiser and `knip` for TypeScript/JavaScript; Ruff, Mypy and
Bandit for Python; PMD and SpotBugs for Java; `detekt` for Kotlin; Clippy,
`cargo-audit` and `cargo-deny` for Rust. Findings are normalized, scored by
severity and confidence, and written out two ways: a SARIF file for GitHub
Code Scanning, and one GitHub issue per finding (deduplicated by a
fingerprint of the tool, rule, file, a line bucketed to ±20 lines, and the
normalized message, so a finding survives minor code movement without being
re-filed).

Use it by adding `.github/workflows/vibecheck.yml` (see
[one-click install](#one-click-install)) and running it from the repo's
Actions tab, or on a schedule. `severity_threshold` and
`confidence_threshold` control the noise floor; `skip_issues: "true"` runs
it as a dry run that writes no issues. It does not fix anything itself
(except through [autofix PRs](#autofix-prs)) and it does not run
continuously — only on dispatch or whatever schedule the workflow sets.

## One-click install

A hosted page, `docs/install.html` (added `78e9227`, 2026-01-06, as "add
one-click install page"), served from GitHub Pages at
`wolffm.github.io/vibecheck/install`. Enter a repo name and it opens a PR
adding the standard `vibecheck.yml` workflow, rather than hand-copying YAML
from the README. It covers the analyze-mode workflow only; audit mode's
workflow is copied from `starter-workflow/vibecompact.yml` instead, because
its permissions and delivery are different enough that a hand-written
variant tends to drift.

## Autofix PRs

Some findings — ESLint formatting, Ruff style — have a command that fixes
them mechanically and safely. With `autofix_prs: "true"` on the action
(requires `contents: write` and `pull-requests: write`), vibeCheck groups
those findings by tool, runs the fix command, and opens a PR with the
result instead of filing an issue for them. It only ever proposes the PR;
nothing merges itself. Findings with no registered safe-fix command are
unaffected and still become issues as usual.

## Azure DevOps delivery

An alternative to GitHub issues for a repo whose work tracking is Azure
DevOps: the same findings, deduplicated the same way, created and updated
as ADO work items instead (`src/ado/ado-api.ts`, `src/ado/findings-to-workitems.ts`,
added `2c3ad58` as "add ADO work item support with --target ado flag",
2026-03-02). It needs `ADO_ORG`, `ADO_PROJECT` and `ADO_PAT` (a personal
access token) set in the environment; an optional `ADO_AREA_PATH` files
work items under a specific area. It is a destination, not a second
analysis pass — the same findings go to one place or the other, not both.

## The vibeCompact audit

A different question than analyze mode: not "what is wrong right now" but
"what does this file's own history and shape say, repeatedly". Six
independent lanes score every tracked file — `size` (code lines against a
language-adjusted tier), `arrival` (the share of a file's commits that
landed with no reaching test), `deadcode` (unused exported surface, via
`knip` for TS/JS and `vulture` for Python), `duplication` (via `jscpd`),
`smells` (`any`-density, via `type-coverage`) and `consistency` (copy
artifacts, orphans, import cycles) — and a file is only reported as a
finding when at least two lanes agree on it (`src/audit/index.ts`). It was
split out from vibeCheck's own identity on 2026-08-08: distinct workflow
(`vibecompact.yml`), distinct data directory (`.vibecompact/`, with the
earlier `.vibecheck/` still read for compatibility) and branch
(`vibecompact/data`), "so the audit product no longer shares vibeCheck's
identity" (`0db9fe9`).

Delivery is two surfaces: a living issue that is always the current
picture, and an **episodic findings PR** that opens only when new findings
fire since the last one was closed — closing that PR (never merging it) is
what the ledger records as the batch being acknowledged, so the same
findings don't reopen a PR next run. A protected default branch gets this
PR-based delivery automatically; a repo that instead gives the workflow a
token that can push its default branch gets the data committed straight to
`vibecompact/data`. Run it from the canonical `starter-workflow/vibecompact.yml`
on a schedule, or by hand with `vibecheck audit`.

## Verdicts and the ledger

A human reviewing an audit finding records one of four verdicts from the
CLI — `vibecheck justify|wontfix|noise|detector-gap <lane>:<path> --reason "..."`
— and it is kept forever in `.vibecompact/ledger.jsonl`, an append-only,
ULID-keyed log that every later run reads before deciding what's new.
`justify` and `wontfix` close a specific finding; `noise` additionally
raises that lane's floor repo-wide, since a lane that is wrong about one
file is probably wrong about others like it; `detector-gap` records that
the finding is mechanically wrong and never ratchets anything, which exists
because maintainers found a floor-wide consequence too costly to accept for
a true detector bug and were filing GitHub issues about it instead of
telling the ledger. `vibecheck floors reset <lane>` reverses a floor raise.
`vibecheck fleet-report` aggregates `detector-gap` verdicts filed across
sibling repos running the same audit, so a defect confirmed once doesn't
need re-confirming everywhere it fires.

## Triage and the agent skill

`vibecheck triage` walks every open audit finding from the terminal one at
a time and files the verdict interactively instead of editing the ledger by
hand. `vibecheck skill emit [--dir <dir>]` writes the same workflow out as
an agent skill file, so an AI agent triaging a repo's findings follows the
same justify/wontfix/noise/detector-gap vocabulary a person would, including
the rule that a `noise` verdict raises a floor and should not be used to
dodge a real finding.

## Trivia

The audit's six-lane design was dogfooded on this repo before being offered
to any other: the first evidence notes and ledger entries for it are dated
2026-08-05 (`c1be94a`), three days before the rename that gave it its own
name.
