# vibeCheck: history

## A frantic first week (January 2026)

The repo's first commit, "feat: initial vibeCop implementation" (`812f82c`,
2026-01-05), built the whole first version under the name **vibeCop**: a
GitHub Action, SARIF and LLM-JSON output, dependency-cruiser and knip
integration the same day (`14a10b8`). It did not keep that name past the next day. "FULL REBRAND" (`4ed3cdb`,
2026-01-06) renamed it to **vibeCheck** throughout the README, the CI
workflow file (`.github/workflows/vibecop.yml` → `vibecheck.yml`), and the
config file (`vibecop.json` → `vibecheck.json`). It also renamed the
default GitHub issue labels the code creates (`DEFAULT_LABELS` in what is
now `src/github/github.ts`). The same day, Python and Java tool support
landed (`5081b9f`) and the one-click install page went up (`78e9227`).

The day after that, "repo restructure" (`dc78d05`, 2026-01-07) moved every
script out of a flat `scripts/` directory into the
`src/{core,github,output,tools,utils}` tree the repo still has. The same
commit dropped the npm lockfile (`package-lock.json`, 5,708 of its 5,786
deleted lines) in favor of what later became a pnpm one. Rust support
followed almost immediately (`ef77b88`, 2026-01-08).

## The quiet spell (March–June 2026)

After that frantic first month the pace dropped off hard. The longest gap
in the project's history ran 115 days, between "fix: extract
CWE/references from semgrep metadata, detect local git info" (`14bd86a`,
2026-03-02 14:25) and the next substantive fix, "fix: arg name mismatch,
KMP Gradle compile, and Trunk PATH detection" (`3163d2c`, 2026-06-26
01:24).
Kotlin support (`detekt`, via `1a511bc`, "#356") landed the same day that
quiet spell ended.

## The vibeCompact audit grows its own identity (August 2026)

A second kind of analysis — a slower, six-lane code-quality audit rather
than a per-finding scanner — was dogfooded on this repo starting 2026-08-05
(`c1be94a`, its first evidence notes and ledger entries). Three days later it was deliberately split from vibeCheck's own branding:
"chore: rename audit surface to vibeCompact" (`0db9fe9`, 2026-08-08). That
commit gave the audit its own workflow file and its own data directory
(`.vibecompact/`, with the previous `.vibecheck/` still read so existing
data wasn't orphaned). It also gave the audit its own branch — "so the
audit product no longer shares vibeCheck's identity." The same day,
evidence packages and briefing-style PR bodies were added (`f86e853`).

Two further rounds reshaped how a maintainer works with it. Episodic
findings PRs let closing the PR, not merging it, tell the system a batch
was triaged (`11981e1`, 2026-08-17). A "verdict v2" pass ten days later made
`justify`/`wontfix`/`noise` decisions generalize across similar files and
aggregate across repos (`8b708dd`, 2026-08-27). Four days after that, nine
detector defects collected from real use were fixed and closed in one
commit (`b67d5d5`, 2026-08-31).

## Trivia

The project's agent instructions moved from `claude.md` to `AGENTS.md` on
2026-09-18, "so any coding agent reads them" (`b7a927b`) — more in
[trivia.md](trivia.md).
