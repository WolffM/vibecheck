# src/utils/fingerprints.ts

Single-lane finding (below the corroboration gate — one signal, weigh accordingly) · firing: deadcode · 6 lanes applicable · anchor `e38f9085d0c2`

### deadcode — 12 of 22 exported items unconsumed

| item | line | action |
|---|---|---|
| `LINE_BUCKET_SIZE` | 23 | un-export — used inside this file |
| `FLAP_PROTECTION_RUNS` | 29 | delete after verification |
| `bucketLine` | 35 | un-export — used inside this file |
| `normalizePathForFingerprint` | 48 | un-export — used inside this file |
| `normalizePathForComparison` | 54 | delete after verification |
| `normalizeMessage` | 63 | un-export — used inside this file |
| `normalizeRuleId` | 72 | un-export — used inside this file |
| `buildFingerprintKey` | 82 | un-export — used inside this file |
| `computeFingerprint` | 102 | un-export — used inside this file |
| `fingerprintsMatch` | 198 | delete after verification |
| `groupByFingerprint` | 206 | delete after verification |
| `MergeStrategy` | 16 | un-export — used inside this file |

Items marked *un-export* are live code — only their `export` keyword is unconsumed. Remove the keyword; deleting the symbol would break this file.

### If this finding is wrong or accepted

```
vibecheck wontfix|noise|justify "deadcode:src/utils/fingerprints.ts" --reason "..."
```
