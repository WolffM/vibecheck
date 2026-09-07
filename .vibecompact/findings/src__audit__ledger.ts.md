# src/audit/ledger.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: size · 6 lanes applicable · anchor `e147b1d50b7a`

### size — 504 code lines (tier 1)

Largest top-level symbols — the natural cut points:

| symbol | kind | lines | span |
|---|---|---|---|
| `foldLedger` | function | 85 | 422–506 |
| `resolveVerdict` | function | 45 | 559–603 |
| `computeRenameEvents` | function | 39 | 614–652 |
| `makeUlid` | function | 34 | 71–104 |
| `findGoverningVerdict` | function | 31 | 289–319 |
| `globToRegExp` | function | 25 | 244–268 |

Suggested first cut: extract `foldLedger` (85 lines) into its own module, with a test first.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "size:src/audit/ledger.ts" --reason "..."
```
