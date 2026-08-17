# src/core/run-analyze.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: consistency · 5 lanes applicable · anchor `e38f9085d0c2` · deletion candidate (orphaned — zero import fan-in, no declared entry point)

### consistency — orphaned (zero import fan-in)

### Pre-run verification

String-reference scan found mentions — **inspect these before treating the file as unreachable** (they usually name the loading mechanism):

- `knip.json:4` — `"src/core/run-analyze.ts",`

### Action

Resolve the references above first; if they are the loading mechanism, file a noise verdict instead:

```
vibecheck noise "consistency:src/core/run-analyze.ts" --reason "..."
```

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "consistency:src/core/run-analyze.ts" --reason "..."
```
