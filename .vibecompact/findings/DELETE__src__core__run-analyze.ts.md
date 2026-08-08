# src/core/run-analyze.ts

Deletion candidate · orphaned — zero import fan-in, no declared entry point · anchor `e9a6d3d66351`

### Pre-run verification

String-reference scan found mentions — **inspect these before treating the file as unreachable** (they usually name the loading mechanism):

- `knip.json:4` — `"src/core/run-analyze.ts",`

### Action

Resolve the references above first; if they are the loading mechanism, file a noise verdict instead:

```
vibecheck noise "consistency:src/core/run-analyze.ts" --reason "..."
```
