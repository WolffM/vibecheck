# src/audit/lanes/duplication.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 4 of 8 exported items unconsumed

| item | line | action |
|---|---|---|
| `DIR_PAIR_MIN_LINES` | 42 | un-export — used inside this file |
| `computeDirPairs` | 85 | un-export — used inside this file |
| `buildDuplicationLane` | 138 | un-export — used inside this file |
| `CloneRef` | 13 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/duplication.ts" --reason "..."
```
