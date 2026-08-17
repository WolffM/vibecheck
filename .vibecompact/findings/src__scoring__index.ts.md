# src/scoring/index.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 9 exported items unconsumed

| item | line | action |
|---|---|---|
| `CONFIDENCE_ORDER` | 11 | delete after verification |
| `compareConfidence` | 12 | delete after verification |
| `compareSeverity` | 14 | delete after verification |
| `meetsConfidenceThreshold` | 15 | delete after verification |
| `meetsSeverityThreshold` | 16 | delete after verification |
| `SEVERITY_ORDER` | 18 | delete after verification |
| `mapEslintConfidence` | 27 | delete after verification |
| `mapEslintSeverity` | 28 | delete after verification |
| `determineAutofixLevel` | 60 | delete after verification |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/scoring/index.ts" --reason "..."
```
