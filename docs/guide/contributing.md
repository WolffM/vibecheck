# vibeCheck: contributing

## Running it locally

```bash
git clone https://github.com/WolffM/vibecheck.git
cd vibecheck
pnpm install
pnpm test
```

To see what a run would actually produce without touching GitHub, run the
local preview pipeline rather than the real action:

```bash
npx tsx tests/local-preview.ts
```

It runs the full analyze-mode pipeline against this repo's own
`test-fixtures/` (deliberately dirty files covering every tool vibeCheck
runs) and writes issue previews to `.vibecheck-test-output/issues/`, plus a
summary at `.vibecheck-test-output/issues-summary.md`. `AGENTS.md` calls out
one thing worth checking in the output: that a multi-location finding's
message states its locations as `Found X occurrences across Y files:` with
no separate `## Location` section, since the two would otherwise duplicate
each other.

To exercise the `vibecheck` CLI itself (what `bin/cli.js` wraps):

```bash
node bin/cli.js analyze --root . --skip-issues   # dry run, no issues filed
node bin/cli.js audit                             # the vibeCompact audit, writes .vibecheck/audit.md
node bin/cli.js detect .                          # just the language/tool detection
```

## Architecture

```
action.yml            the GitHub Action itself: inputs, outputs, the steps for
                       analyze mode, audit mode and autofix PRs
bin/cli.js             the `vibecheck` CLI: analyze, audit, justify/wontfix/
                       noise/detector-gap, ledger, floors, triage, skill, detect
src/core/              repo/language detection, the analyze entry point, shared types
src/tools/             per-language runners (typescript.ts, python.ts, java.ts,
                       kotlin.ts, rust.ts, security.ts) and the autofix registry
src/parsers/           turns each tool's native output into vibeCheck's Finding shape
src/scoring/           severity/confidence thresholds, sort order
src/output/            SARIF and LLM-JSON builders, issue body formatting
src/github/            the GitHub issue client, workflow-file generator for the
                       one-click install page
src/ado/                the Azure DevOps delivery path: work-item CRUD, the
                       findings-to-work-items converter
src/audit/             vibeCompact: the six lanes (src/audit/lanes/), the
                       verdict ledger (ledger.ts), the activity gate (gate.ts),
                       data-branch and GitHub/local publish (publish/), the
                       CLI subcommands, the agent skill emitter
tests/                 vitest; tests/local-preview.ts (above), tests/golden/
                       for the audit report format
docs/                  install.html (the one-click install page), the
                       vibeCompact design notes
starter-workflow/      the canonical vibecompact.yml to copy into a caller repo
```

## Tests and gates

```bash
pnpm run lint        # eslint src/ --max-warnings=0
pnpm run typecheck   # tsc --noEmit
pnpm test            # vitest run
```

`.github/workflows/ci.yml` runs all three (`pnpm install --frozen-lockfile`
first) on every push to `main` and every pull request, and is this repo's
only fork-triggerable workflow — it deliberately always runs on a
GitHub-hosted runner rather than the self-hosted one `vibecheck.yml` and
`vibecompact.yml` use, specifically because a fork's `package.json` scripts
run as part of `pnpm install`/`pnpm run`, and a self-hosted runner is a
persistent machine, not a disposable one.

## How it deploys

There is no server to deploy: vibeCheck ships as a GitHub Action that a
caller repo references by tag or branch (`uses: WolffM/vibecheck@main`, or
a pinned release such as `v1.1.1`). A push to `main` is immediately what
`@main` runs; cutting a tag (`v1.0.0`, `v1.1.0`, `v1.1.1` so far) gives a
caller a version that won't move under it. The CLI (`bin/cli.js`) is also
published as the `vibecheck` package for anyone who wants to run it outside
the Action.

## Trivia

`v1.0.0` was tagged on the project's first day, 2026-01-05 (`0cc5fcc`,
`git log -1 --format='%h %ad' v1.0.0`) — the same day as the initial
commit.
