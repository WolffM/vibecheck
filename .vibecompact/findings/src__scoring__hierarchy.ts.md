# src/scoring/hierarchy.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 6 of 8 exported items unconsumed

| item | line | action |
|---|---|---|
| `SEVERITY_ORDER` | 18 | un-export — used inside this file |
| `compareSeverity` | 32 | delete after verification |
| `meetsSeverityThreshold` | 40 | un-export — used inside this file |
| `CONFIDENCE_ORDER` | 54 | un-export — used inside this file |
| `compareConfidence` | 63 | delete after verification |
| `meetsConfidenceThreshold` | 70 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/scoring/hierarchy.ts" --reason "..."
```
