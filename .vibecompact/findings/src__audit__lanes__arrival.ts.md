# src/audit/lanes/arrival.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 6 of 9 exported items unconsumed

| item | line | action |
|---|---|---|
| `ARRIVAL_MIN_TOUCHES` | 28 | un-export — used inside this file |
| `ARRIVAL_WINDOW_DAYS` | 30 | un-export — used inside this file |
| `isSnapshotFile` | 45 | un-export — used inside this file |
| `arrivalLanguageFamily` | 67 | un-export — used inside this file |
| `buildArrivalLane` | 118 | un-export — used inside this file |
| `buildTestReachability` | 243 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/arrival.ts" --reason "..."
```
