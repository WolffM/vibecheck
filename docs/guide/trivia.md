# vibeCheck: trivia

- The first commit's message is "feat: initial vibeCop implementation"
  (`812f82c`, 2026-01-05) — the project was renamed to vibeCheck the next
  day, in a commit titled, simply, "FULL REBRAND" (`4ed3cdb`).
- Its shortest commit subject is one word, "go". Three separate commits
  share that exact subject (`764b637`, `28ef457`, `3d4d52c`). Its longest
  is "fix(audit): PR rung degrades to artifact on permission failure;
  workflow grants pull-requests: write" (`2756b2d`, 2026-08-07, 100
  characters, `git log --format=%s | awk '{print length, $0}' | sort -n`).
- The first day of the project is still its busiest: 65 of its 304 commits
  landed on 2026-01-05 alone (fact sheet, 2026-11-16).
- `action.yml` is changed in more commits than any other file in the
  repo's history: 55, as of 2026-11-16
  (`git log origin/main --oneline -- action.yml | wc -l`). It is both the
  GitHub Action manifest and the only place analyze mode, audit mode and
  autofix PRs are wired together.
- Five of the deliberately-dirty files under `test-fixtures/` —
  `circular-dep-a.ts`, `circular-dep-b.ts`, `duplicate-code-a.ts`,
  `duplicate-code-b.ts` and `unused-exports.ts` — have not changed since
  the day they were added, `ce714c2`, 2026-01-05 (`git log -1 -- <file>`
  per file). A sixth, `security-issues.ts`, got one bot-authored follow-up
  fix later the same day (`982ee0f`) and has not changed since.
- One commit fixed a problem with fixing problems: "fix: make pre-commit
  hook executable so git actually runs it" (`1704281`, 2026-08-05).
