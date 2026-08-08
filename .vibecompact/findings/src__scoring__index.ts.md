# src/scoring/index.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `94ac573613eb`

### deadcode — 9 of 4 exported items unconsumed

| item | line |
|---|---|
| `CONFIDENCE_ORDER` | 11 |
| `compareConfidence` | 12 |
| `compareSeverity` | 14 |
| `meetsConfidenceThreshold` | 15 |
| `meetsSeverityThreshold` | 16 |
| `SEVERITY_ORDER` | 18 |
| `mapEslintConfidence` | 27 |
| `mapEslintSeverity` | 28 |
| `determineAutofixLevel` | 60 |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/scoring/index.ts" --reason "..."
```
