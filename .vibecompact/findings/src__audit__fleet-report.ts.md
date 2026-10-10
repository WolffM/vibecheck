# src/audit/fleet-report.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `e147b1d50b7a`

### deadcode — 7 of 8 exported items unconsumed

| item | line | action |
|---|---|---|
| `findLedgerRepos` | 46 | un-export — used inside this file |
| `OPERATOR_RETRACTION` | 83 | un-export — used inside this file |
| `inferMechanism` | 86 | un-export — used inside this file |
| `buildFleetReport` | 111 | un-export — used inside this file |
| `renderFleetReport` | 190 | un-export — used inside this file |
| `FleetClaim` | 25 | un-export — used inside this file |
| `FleetReport` | 35 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/fleet-report.ts" --reason "..."
```
