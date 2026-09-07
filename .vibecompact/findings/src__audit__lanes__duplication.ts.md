# src/audit/lanes/duplication.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e147b1d50b7a`

### deadcode — 6 of 10 exported items unconsumed

| item | line | action |
|---|---|---|
| `DIR_PAIR_MIN_LINES` | 44 | un-export — used inside this file |
| `countCodeLinesInSpan` | 72 | un-export — used inside this file |
| `mergedIntervals` | 98 | un-export — used inside this file |
| `computeDirPairs` | 127 | un-export — used inside this file |
| `buildDuplicationLane` | 180 | un-export — used inside this file |
| `CloneRef` | 15 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/duplication.ts" --reason "..."
```
