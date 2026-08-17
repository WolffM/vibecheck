# src/audit/lanes/size.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 5 of 8 exported items unconsumed

| item | line | action |
|---|---|---|
| `SIZE_LANGUAGE_MULTIPLIERS` | 18 | un-export — used inside this file |
| `sizeMultiplier` | 27 | un-export — used inside this file |
| `isDataLanguage` | 54 | un-export — used inside this file |
| `buildSizeLane` | 106 | un-export — used inside this file |
| `SizeTier` | 58 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/size.ts" --reason "..."
```
