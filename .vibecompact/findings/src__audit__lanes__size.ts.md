# src/audit/lanes/size.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `94ac573613eb`

### deadcode — 5 of 8 exported items unconsumed

| item | line |
|---|---|
| `SIZE_LANGUAGE_MULTIPLIERS` | 17 |
| `sizeMultiplier` | 26 |
| `isDataLanguage` | 53 |
| `buildSizeLane` | 96 |
| `SizeTier` | 57 |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/size.ts" --reason "..."
```
