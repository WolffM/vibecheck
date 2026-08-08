# src/audit/lanes/arrival.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `94ac573613eb`

### deadcode — 5 of 8 exported items unconsumed

| item | line |
|---|---|
| `ARRIVAL_MIN_TOUCHES` | 28 |
| `ARRIVAL_WINDOW_DAYS` | 30 |
| `isSnapshotFile` | 45 |
| `buildArrivalLane` | 105 |
| `buildTestReachability` | 210 |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/arrival.ts" --reason "..."
```
