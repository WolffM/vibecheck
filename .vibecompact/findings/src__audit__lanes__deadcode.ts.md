# src/audit/lanes/deadcode.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e147b1d50b7a`

### deadcode — 6 of 9 exported items unconsumed

| item | line | action |
|---|---|---|
| `SINGLE_SOURCE_DEMOTION` | 24 | un-export — used inside this file |
| `KNIP_FILES_MUTE_SHARE` | 26 | un-export — used inside this file |
| `KNIP_FILES_MUTE_MIN_CANDIDATES` | 29 | un-export — used inside this file |
| `classifyInternalUse` | 70 | un-export — used inside this file |
| `countDefinitions` | 91 | un-export — used inside this file |
| `buildDeadcodeLane` | 117 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/deadcode.ts" --reason "..."
```
