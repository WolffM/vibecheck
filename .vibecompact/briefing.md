# vibeCompact — agent briefing

Anchor: `e38f9085d0c2` (2026-08-13). Generated with the audit report; findings below are corroborated by ≥2 independent lanes unless marked otherwise.

## Ground rules

- Fixes need no ceremony: land a commit touching a flagged file and the next audit stamps it `fixed` automatically. Partial progress shows as **improving**.
- Findings you judge wrong get verdicts, not workarounds — the commands are attached to each finding. Verdicts are maintainer decisions; confirm with the human before filing one.
- Do not delete anything without resolving the pre-run verification section on its deletion package.

## Corroborated work items

None pass the ≥2-lane gate this run.

## Single-lane findings (one signal each — weigh accordingly)

Each has a full evidence package in `.vibecompact/findings/`.

- `src/audit/skill-cli.ts` — deadcode: entire file unreferenced → `.vibecompact/findings/src__audit__skill-cli.ts.md`
- `src/github/workflow-generator.ts` — deadcode: entire file unreferenced → `.vibecompact/findings/src__github__workflow-generator.ts.md`
- `src/scoring/autofix.ts` — deadcode: unconsumed exports: determineAutofixLevel → `.vibecompact/findings/src__scoring__autofix.ts.md`
- `src/scoring/index.ts` — deadcode: unconsumed exports: CONFIDENCE_ORDER, compareConfidence, compareSeverity +6 → `.vibecompact/findings/src__scoring__index.ts.md`
- `scripts/vibecheck-analysis.ts` — size: 905 code lines (tier 1) → `.vibecompact/findings/scripts__vibecheck-analysis.ts.md`
- `src/tools/runners/typescript.ts` — arrival → `.vibecompact/findings/src__tools__runners__typescript.ts.md`
- `src/tools/tool-runners.ts` — arrival → `.vibecompact/findings/src__tools__tool-runners.ts.md`
- `src/scoring/hierarchy.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): SEVERITY_ORDER, compareSeverity, meetsSeverityThreshold +3 → `.vibecompact/findings/src__scoring__hierarchy.ts.md`
- `src/audit/lanes/arrival.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): ARRIVAL_MIN_TOUCHES, ARRIVAL_WINDOW_DAYS, isSnapshotFile +3 → `.vibecompact/findings/src__audit__lanes__arrival.ts.md`
- `src/audit/lanes/deadcode.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): SINGLE_SOURCE_DEMOTION, KNIP_FILES_MUTE_SHARE, KNIP_FILES_MUTE_MIN_CANDIDATES +3 → `.vibecompact/findings/src__audit__lanes__deadcode.ts.md`
- `src/audit/lanes/size.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): SIZE_LANGUAGE_MULTIPLIERS, sizeMultiplier, isDataLanguage +2 → `.vibecompact/findings/src__audit__lanes__size.ts.md`
- `src/audit/gate.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): GATE_VOLUME_LINES, GATE_STALENESS_DAYS, GateReason → `.vibecompact/findings/src__audit__gate.ts.md`
- `src/core/run-analyze.ts` — consistency → `.vibecompact/findings/src__core__run-analyze.ts.md`
- `src/tools/autofix-runner.ts` — arrival → `.vibecompact/findings/src__tools__autofix-runner.ts.md`
- `src/utils/fingerprints.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): LINE_BUCKET_SIZE, FLAP_PROTECTION_RUNS, bucketLine +9 → `.vibecompact/findings/src__utils__fingerprints.ts.md`
- `src/utils/fix-templates.ts` — size: 535 code lines (tier 1) → `.vibecompact/findings/src__utils__fix-templates.ts.md`
- `src/utils/shared.ts` — arrival → `.vibecompact/findings/src__utils__shared.ts.md`
- `src/tools/runners/rust.ts` — arrival → `.vibecompact/findings/src__tools__runners__rust.ts.md`
- `src/tools/runners/python.ts` — arrival → `.vibecompact/findings/src__tools__runners__python.ts.md`
- `src/tools/runners/java.ts` — arrival → `.vibecompact/findings/src__tools__runners__java.ts.md`
- `src/audit/publish/github-cli.ts` — arrival → `.vibecompact/findings/src__audit__publish__github-cli.ts.md`
- `bin/cli.js` — arrival → `.vibecompact/findings/bin__cli.js.md`
- `src/tools/runners/security.ts` — arrival → `.vibecompact/findings/src__tools__runners__security.ts.md`
- `src/audit/cli.ts` — arrival → `.vibecompact/findings/src__audit__cli.ts.md`
- `src/github/sarif-to-issues.ts` — arrival → `.vibecompact/findings/src__github__sarif-to-issues.ts.md`
- `src/parsers/index.ts` — arrival → `.vibecompact/findings/src__parsers__index.ts.md`
- `eslint.config.mjs` — arrival → `.vibecompact/findings/eslint.config.mjs.md`
- `src/audit/lanes/duplication.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): DIR_PAIR_MIN_LINES, computeDirPairs, buildDuplicationLane +1 → `.vibecompact/findings/src__audit__lanes__duplication.ts.md`
- `src/tools/autofix-registry.ts` — deadcode: unconsumed exports (some used internally — un-export, don't delete): BUILTIN_AUTOFIX, getAutofixTools, hasAutofixSupport → `.vibecompact/findings/src__tools__autofix-registry.ts.md`
- `src/core/repo-detect.ts` — smells → `.vibecompact/findings/src__core__repo-detect.ts.md`

## Deletion candidates (single-signal, verify before acting)

Below-gate but directly actionable once verified. Verification = repo-wide search for string references, dynamic imports, and runner configs.

- `src/audit/skill-cli.ts` — knip: entire file unreferenced
- `src/core/run-analyze.ts` — orphaned — zero import fan-in, no declared entry point
- `src/github/workflow-generator.ts` — knip: entire file unreferenced

## Machine data

Full lane entries, clone partners, scores, and ledger state: `.vibecompact/audit.json` on the data branch, `.vibecompact/out/audit.json` in a local run.
