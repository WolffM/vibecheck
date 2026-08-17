# scripts/vibecheck-analysis.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `e38f9085d0c2`

### size — 905 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `analyzeQ5_BuildBreaks` | async function | 232 | 723–954 |
| `analyzeQ2_AutofixCandidates` | async function | 206 | 276–481 |
| `analyzeQ4_UselessRules` | async function | 159 | 564–722 |
| `analyzeQ1_BundleableIssues` | async function | 149 | 127–275 |
| `analyzeQ3_DefaultSeverity` | async function | 82 | 482–563 |
| `main` | async function | 57 | 955–1011 |

Suggested first cut: extract `analyzeQ5_BuildBreaks` (232 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:scripts/vibecheck-analysis.ts" --reason "..."
```
