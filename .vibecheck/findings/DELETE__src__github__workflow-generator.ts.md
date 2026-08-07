# src/github/workflow-generator.ts

Deletion candidate · knip: entire file unreferenced · anchor `e9a6d3d66351`

### Pre-run verification

String-reference scan: **clean** — no other tracked file mentions `workflow-generator.ts`'s stem. Remaining risk is out-of-repo consumers (deploy scripts, external repos).

### Action

Delete the file; CI plus one manual smoke of any runtime loaders is the remaining check.

```
vibecheck noise "consistency:src/github/workflow-generator.ts" --reason "..."
```
