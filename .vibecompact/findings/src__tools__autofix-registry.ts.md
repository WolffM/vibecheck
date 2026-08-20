# src/tools/autofix-registry.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 5 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 3 of 6 exported items unconsumed

| item | line | action |
|---|---|---|
| `BUILTIN_AUTOFIX` | 37 | un-export — used inside this file |
| `getAutofixTools` | 131 | delete after verification |
| `hasAutofixSupport` | 163 | delete after verification |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/tools/autofix-registry.ts" --reason "..."
```
