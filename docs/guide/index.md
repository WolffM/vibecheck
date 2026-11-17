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
