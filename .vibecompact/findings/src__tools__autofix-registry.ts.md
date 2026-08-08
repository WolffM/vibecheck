# src/tools/autofix-registry.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `94ac573613eb`

### deadcode — 3 of 6 exported items unconsumed

| item | line |
|---|---|
| `BUILTIN_AUTOFIX` | 37 |
| `getAutofixTools` | 131 |
| `hasAutofixSupport` | 163 |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/tools/autofix-registry.ts" --reason "..."
```
