# scripts/vibecheck-analysis.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 5 lanes applicable · anchor `e147b1d50b7a`

### size — 905 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `analyzeQ5_BuildBreaks` | async function | 228 | 723–950 |
| `analyzeQ2_AutofixCandidates` | async function | 202 | 276–477 |
| `analyzeQ4_UselessRules` | async function | 111 | 564–674 |
| `analyzeQ3_DefaultSeverity` | async function | 82 | 482–563 |
| `analyzeQ1_BundleableIssues` | async function | 68 | 127–194 |
| `main` | async function | 55 | 955–1009 |

Suggested first cut: extract `analyzeQ5_BuildBreaks` (228 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:scripts/vibecheck-analysis.ts" --reason "..."
```
