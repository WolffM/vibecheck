# src/audit/lanes/deadcode.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `94ac573613eb`

### deadcode — 5 of 8 exported items unconsumed

| item | line |
|---|---|
| `SINGLE_SOURCE_DEMOTION` | 23 |
| `KNIP_FILES_MUTE_SHARE` | 25 |
| `KNIP_FILES_MUTE_MIN_CANDIDATES` | 28 |
| `countDefinitions` | 57 |
| `buildDeadcodeLane` | 83 |

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/audit/lanes/deadcode.ts" --reason "..."
```
