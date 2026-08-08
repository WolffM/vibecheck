# src/audit/gate.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `94ac573613eb`

### deadcode — 3 of 5 exported items unconsumed

| item | line |
|---|---|
| `GATE_VOLUME_LINES` | 36 |
| `GATE_STALENESS_DAYS` | 37 |
| `GateReason` | 39 |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/gate.ts" --reason "..."
```
