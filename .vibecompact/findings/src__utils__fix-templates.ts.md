# src/utils/fix-templates.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 6 lanes applicable · anchor `94ac573613eb`

### size — 535 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `FIX_TEMPLATES` | const | 315 | 55–369 |
| `GENERIC_TOOL_HINTS` | const | 188 | 395–582 |
| `extractVersionFromMessage` | function | 29 | 26–54 |
| `createUnusedVarsTemplate` | function | 25 | 370–394 |
| `getSuggestedFix` | function | 25 | 583–607 |

Suggested first cut: extract `FIX_TEMPLATES` (315 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:src/utils/fix-templates.ts" --reason "..."
```
