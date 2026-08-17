# src/github/workflow-generator.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e38f9085d0c2` · deletion candidate (knip: entire file unreferenced)

### deadcode — entire file unreferenced (knip)

### Pre-run verification

String-reference scan: **clean** — no other tracked file mentions `workflow-generator.ts`'s stem. Remaining risk is out-of-repo consumers (deploy scripts, external repos).

### Action

Delete the file; CI plus one manual smoke of any runtime loaders is the remaining check.

```
vibecheck noise "consistency:src/github/workflow-generator.ts" --reason "..."
```

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/github/workflow-generator.ts" --reason "..."
```
