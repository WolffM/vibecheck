# src/audit/gate.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 3 of 5 exported items unconsumed

| item | line | action |
|---|---|---|
| `GATE_VOLUME_LINES` | 41 | un-export — used inside this file |
| `GATE_STALENESS_DAYS` | 42 | un-export — used inside this file |
| `GateReason` | 44 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/gate.ts" --reason "..."
```
