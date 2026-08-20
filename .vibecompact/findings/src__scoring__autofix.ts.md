# src/scoring/autofix.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 1 of 1 exported items unconsumed

| item | line | action |
|---|---|---|
| `determineAutofixLevel` | 41 | delete after verification |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/scoring/autofix.ts" --reason "..."
```
