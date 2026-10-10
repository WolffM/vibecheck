# src/utils/fix-templates.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 6 lanes applicable · anchor `e147b1d50b7a`

### size — 535 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `FIX_TEMPLATES` | const | 307 | 55–361 |
| `GENERIC_TOOL_HINTS` | const | 179 | 395–573 |
| `getSuggestedFix` | function | 21 | 583–603 |
| `createUnusedVarsTemplate` | function | 16 | 370–385 |

Suggested first cut: extract `FIX_TEMPLATES` (307 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:src/utils/fix-templates.ts" --reason "..."
```
