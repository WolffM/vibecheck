---
title: vibeCheck
summary: >-
  A GitHub Action that runs static analysis across any repo's languages and
  turns the findings into actionable GitHub issues (or Azure DevOps work
  items) for an AI coding agent to resolve. A second mode, vibeCompact, runs
  a slower six-lane code-quality audit and remembers every human verdict in
  a ledger so the same finding is never re-litigated.
features:
  - name: Static analysis and issues
    summary: "Detects a repo's languages, runs the matching tools, files one GitHub issue per finding."
    anchor: static-analysis-and-issues
  - name: One-click install
    summary: "A hosted page writes the workflow file for you; no YAML by hand."
    anchor: one-click-install
  - name: Autofix PRs
    summary: "Findings with a safe mechanical fix (formatting, lint style) land as a PR instead of an issue."
    anchor: autofix-prs
  - name: Azure DevOps delivery
    summary: "The same findings as ADO work items, for a repo that is not on GitHub issues."
    anchor: azure-devops-delivery
  - name: The vibeCompact audit
    summary: "Six deterministic lanes score every tracked file; a finding needs two lanes agreeing."
    anchor: the-vibecompact-audit
  - name: Verdicts and the ledger
    summary: "justify, wontfix, noise or detector-gap a finding once; it is remembered."
    anchor: verdicts-and-the-ledger
  - name: Triage and the agent skill
    summary: "Walk every open finding from the CLI, or hand an agent the same workflow as a skill."
    anchor: triage-and-the-agent-skill
trivia:
  - 'The whole repo started life under a different name: the first commit''s message is "feat: initial vibeCop implementation" (`812f82c`, 2026-01-05).'
  - 'That name lasted one day: "FULL REBRAND" (`4ed3cdb`, 2026-01-06) renamed vibeCop to vibeCheck throughout the README, the config file and the GitHub labels.'
  - 'Its shortest commit subject is one word, "go" (`3d4d52c`, one of three commits with that exact subject); its longest is "fix(audit): PR rung degrades to artifact on permission failure; workflow grants pull-requests: write" (`2756b2d`, 2026-08-07).'
  - "The first day of the project is still its busiest: 65 of its commits landed on 2026-01-05 alone (fact sheet, 2026-11-16)."
---

# vibeCheck

vibeCheck is a GitHub Action: point it at a repository and it detects which
languages are in use, then runs the matching static-analysis tools. Each
finding becomes a GitHub issue written for an AI coding agent to pick up and
fix — a suggested approach, acceptance criteria, and a stable fingerprint so
the same finding is not re-filed on the next run.

A second mode, **vibeCompact**, is a slower, six-lane code-quality audit
rather than a per-finding scanner. It looks for files that several
independent signals agree are a problem, and delivers them as a periodic
pull request and a living issue. It keeps a ledger of every verdict a
maintainer has already made, so a dismissed finding does not keep coming
back.

The `vibecheck` CLI's language detection, run against this repo's own
checkout (`node bin/cli.js detect .`; false fields and the local path left
out, and `workspacePackages` is empty here):

```json
{
  "languages": ["typescript", "python", "rust", "java"],
  "packageManager": "pnpm",
  "isMonorepo": true,
  "hasTypeScript": true,
  "hasEslint": true,
  "hasTrunk": true,
  "hasDependencyCruiser": true,
  "hasKnip": true,
  "hasPython": true,
  "hasJava": true,
  "hasRust": true
}
```

- [Features](features.md): what each mode does and how to turn it on.
- [Contributing](contributing.md): running it locally, the architecture, the
  checks it must pass.
- [History](history.md): a one-day rename, and the audit mode that grew its
  own identity.
- [Trivia](trivia.md)

## Trivia

The project's own name didn't survive its first week —
[history](history.md#a-frantic-first-week-january-2026) has the rename.
