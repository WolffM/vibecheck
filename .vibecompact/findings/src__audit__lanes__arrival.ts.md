# src/audit/lanes/arrival.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e147b1d50b7a`

### deadcode — 7 of 10 exported items unconsumed

| item | line | action |
|---|---|---|
| `ARRIVAL_MIN_TOUCHES` | 28 | un-export — used inside this file |
| `ARRIVAL_WINDOW_DAYS` | 30 | un-export — used inside this file |
| `isSnapshotFile` | 45 | un-export — used inside this file |
| `isToolingConfig` | 63 | un-export — used inside this file |
| `arrivalLanguageFamily` | 86 | un-export — used inside this file |
| `buildArrivalLane` | 137 | un-export — used inside this file |
| `buildTestReachability` | 276 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/arrival.ts" --reason "..."
```
