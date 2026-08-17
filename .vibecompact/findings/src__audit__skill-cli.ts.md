# src/audit/skill-cli.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `e38f9085d0c2` · deletion candidate (knip: entire file unreferenced)

### deadcode — entire file unreferenced (knip)

### Pre-run verification

String-reference scan found mentions — **inspect these before treating the file as unreachable** (they usually name the loading mechanism):

- `bin/cli.js:132` — `runScript("audit/skill-cli.ts", args.slice(1));`

### Action

Resolve the references above first; if they are the loading mechanism, file a noise verdict instead:

```
vibecheck noise "consistency:src/audit/skill-cli.ts" --reason "..."
```

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/skill-cli.ts" --reason "..."
```
