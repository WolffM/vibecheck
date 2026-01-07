# vibeCheck — Cross‑Repo Static Analysis + Actionable Issue Generator (Spec)

**Project name:** `vibeCheck`  
**Primary goal:** a **generic**, **repo-agnostic** static analysis pipeline that runs asynchronously (scheduled) and turns results into **actionable GitHub Issues** intended to be resolved by an AI agent (e.g., Codex) via PRs.

This spec is written so another agent can build the full system end‑to‑end.

---

## 0) Executive summary

`vibeCheck` is a central GitHub repository that provides:

1. A **reusable GitHub Actions workflow** that any repo can call (2–10 lines per repo).
2. A **static analysis runner** based on **Trunk** (plus optional add‑on tools).
3. A **results normalizer** that emits:
   - `results.sarif` (for GitHub Code Scanning UI + history)
   - `results.llm.json` (for LLM agents to work issues systematically)
4. An **issue orchestrator** that creates/updates/optionally closes GitHub Issues based on findings, with stable deduping and labels.
5. Optional PR UX: **reviewdog** comments on diffs (PR-only), while scheduled runs open Issues + upload SARIF.

---

## 1) Design goals

### Must-haves
- **One command** in CI: “analyze this repo” (like `eslint`/`prettier`).
- **Repo‑agnostic:** detects repo shape automatically; no up‑front “monorepo vs single package” prompt.
- **Asynchronous by default:** scheduled runs (nightly/weekly) to avoid slowing daily workflow.
- **Actionable Issues:** findings converted into issues with clear remediation steps, evidence, and suggested ownership.
- **AI-friendly output:** a structured JSON file for an agent to process findings deterministically.
- **Deduping:** stable fingerprints to avoid spamming duplicates across runs.
- **Customization per repo:** allow overrides (e.g., trunk config flags, tool enablement, thresholds).

### Non-goals
- Not a replacement for CodeQL as a security program.
- Not a fully interactive UI/dashboard beyond GitHub Code Scanning + Issues.
- Not a monolithic “run every tool ever” by default; must stay pragmatic and minimize noise.

---

## 2) High-level architecture

### Central repo (`vibeCheck`)
- Owns:
  - Reusable workflow (`workflow_call`)
  - Default Trunk config policy (baseline)
  - Scripts to normalize results to SARIF + LLM JSON
  - Scripts to create/update issues
  - Optional bootstrap tool to install the caller workflow into many repos

### Runner repos (your code repos)
- Each contains a small caller workflow file that:
  - Schedules runs
  - Calls the central reusable workflow
  - Optionally provides repo-specific settings via a config file committed in the repo

### Results & surfacing
- **SARIF** uploaded to GitHub Code Scanning (best UI + per‑finding metadata)
- **GitHub Issues** created/updated for curated high-confidence findings
- **LLM JSON** emitted as an artifact for external agents

---

## 3) Repo structure (central `vibeCheck` repo)

```
vibeCheck/
  .github/
    workflows/
      reusable-analyze.yml
      reusable-pr-review.yml          (optional)
      bootstrap-install.yml           (optional, manual trigger)
  config/
    trunk.yaml                        (baseline policy)
    vibeCheck.schema.json               (schema for per-repo config)
    default-issue-templates/          (optional)
  scripts/
    build-sarif.ts                    (or .js)
    build-llm-json.ts                 (or combined with build-sarif)
    sarif-to-issues.ts
    github.ts                         (GH API helpers)
    fingerprints.ts                   (dedupe logic)
    scoring.ts                        (severity/confidence mapping)
    repo-detect.ts                    (repo fingerprinting)
  templates/
    caller-workflow.yml
    vibecheck.yml                       (optional starter per-repo config)
  package.json
  tsconfig.json
  README.md
  LICENSE
```

**Language/tooling preference:** TypeScript/Node for scripts. Keep dependencies minimal.

---

## 4) Runner toolchain

### 4.1 Default analyzers (baseline)
Minimum set to run in scheduled scans:
- **Trunk**: orchestrates multiple linters/formatters; provides repo autodetection.
- **TypeScript typecheck:** `tsc --noEmit` (if TS detected).
- **ESLint:** if config present (Trunk can run it or direct).
- **Prettier:** for formatting checks (as needed).
- **jscpd:** duplicate code (optional by default; recommended weekly).
- **dependency-cruiser / madge:** cycles & boundary rules (optional).
- **knip:** unused files/exports/deps (optional, tends to be heavier).
- **semgrep:** optional security-ish + custom patterns.

**Implementation note:** Prefer to let **Trunk** manage running tools when available; allow optional “native” runs when Trunk integration isn’t sufficient or outputs aren’t capturable.

### 4.2 Optional PR diff layer
- **reviewdog**: on PRs, comment only on diff findings to reduce noise.

---

## 5) Configuration & customization

### 5.1 Central default config (`config/trunk.yaml`)
- Provide sensible defaults that are safe for most repos:
  - consistent formatting
  - basic linting
  - avoid overly opinionated rules
- Keep it minimal to avoid breaking unknown repos.

### 5.2 Per-repo override config (`vibecheck.yml`)
Each runner repo may optionally commit a `vibecheck.yml` file at repo root:

```yaml
version: 1

schedule:
  cadence: weekly   # daily|weekly|monthly (caller workflow controls this)
  deep_scan: true   # if true, enable heavier tools

trunk:
  enabled: true
  arguments: "check"
  # optional: point to a repo-local trunk.yaml or pass extra args
  extra_args: []

tools:
  tsc:
    enabled: auto    # auto|true|false
  eslint:
    enabled: auto
  prettier:
    enabled: auto
  jscpd:
    enabled: weekly
    min_tokens: 70
    threshold: 1     # percent duplication threshold
  dependency_cruiser:
    enabled: weekly
    config_path: ".dependency-cruiser.js"
  knip:
    enabled: monthly
    config_path: "knip.json"
  semgrep:
    enabled: monthly
    config: "p/default"
    # allow a local rules folder
    rules_path: "semgrep-rules"

issues:
  enabled: true
  label: "vibeCheck"
  max_new_per_run: 25
  severity_threshold: "medium"        # low|medium|high|critical
  confidence_threshold: "high"        # low|medium|high
  close_resolved: false               # if true, auto-close issues no longer found
  assignees: []                       # optional default assignees
  project: null                       # optional future

output:
  sarif: true
  llm_json: true
  artifact_retention_days: 14

llm:
  # embed guidance into issue body + llm json
  agent_hint: "codex"
  pr_branch_prefix: "vibecheck/"
```

**Rules:**
- Any field may be omitted; defaults apply.
- `enabled: auto` means “detect if repo supports it (config files present, language detected).”
- `weekly/monthly` means “only run in those scheduled cadences; skip for PR or daily runs.”

### 5.3 Repo fingerprinting (“auto relevance”)
Implement a `repo-detect.ts` that inspects:
- `package.json`, lockfile(s), workspaces
- `tsconfig*.json` existence
- `eslint`/`prettier` config presence
- `apps/*`, `packages/*`, `pnpm-workspace.yaml`, `turbo.json`, etc.
- language indicators (JS/TS/Go/Python/etc.) for future extensibility

Output a `RepoProfile` used to decide tool enablement when `auto`.

---

## 6) Output formats

### 6.1 SARIF (`results.sarif`)
- Standard SARIF 2.1.0 JSON file.
- Used for:
  - GitHub Code Scanning upload
  - stable location metadata
  - tool/rule references

**Required fields in SARIF results:**
- `runs[].tool.driver.name`
- `runs[].results[].ruleId`
- `runs[].results[].message.text`
- `runs[].results[].locations[].physicalLocation.artifactLocation.uri`
- line/column regions when available

### 6.2 LLM JSON (`results.llm.json`)
A compact, deterministic schema designed for agents:

```json
{
  "version": 1,
  "repo": { "owner": "X", "name": "Y", "defaultBranch": "main", "commit": "SHA" },
  "generatedAt": "2026-01-05T00:00:00Z",
  "profile": { "isMonorepo": true, "languages": ["ts"], "packageManager": "pnpm" },
  "summary": { "totalFindings": 42, "highConfidence": 10, "actionable": 8 },
  "findings": [
    {
      "fingerprint": "sha256:....",
      "layer": "code|architecture|system|security",
      "tool": "eslint|jscpd|trunk|depcruise|knip|semgrep|tsc",
      "ruleId": "string",
      "title": "string",
      "message": "string",
      "severity": "low|medium|high|critical",
      "confidence": "low|medium|high",
      "autofix": "none|safe|requires_review",
      "locations": [
        { "path": "src/x.ts", "startLine": 10, "startColumn": 5, "endLine": 20, "endColumn": 2 }
      ],
      "evidence": { "snippet": "optional", "links": [] },
      "suggestedFix": {
        "goal": "string",
        "steps": ["...", "..."],
        "acceptance": ["...", "..."]
      },
      "labels": ["vibeCheck", "refactor", "duplicates"]
    }
  ]
}
```

**Notes:**
- `fingerprint` must be stable across runs when the underlying issue is unchanged.
- `layer` maps to your "multi-level depth" concept.
- `suggestedFix` can be autogenerated from rule metadata + templates.

---

## 7) Confidence & severity scoring

### 7.1 Baseline mapping
Use a simple rubric:

**High confidence**
- Type errors (tsc)
- Circular dependencies (madge/depcruise cycles)
- Forbidden imports / boundary violations (depcruise rules)
- Exact/near-exact duplicates (jscpd)
- Unused exports / unused dependencies (knip / ts-prune style)
- Semgrep findings from strict rulesets (custom “high confidence” rules only)

**Medium confidence**
- Complexity thresholds (Sonar-like)
- “Code smell” heuristics with clear thresholds
- Lint rules that are not strictly correctness

**Low confidence**
- stylistic or preference rules

### 7.2 Severity mapping
Define tool-specific mapping functions in `scoring.ts`.
- ESLint severity: 2=error -> high, 1=warn -> medium, 0=info -> low
- jscpd: duplication count + token size -> medium/high based on thresholds
- depcruise: forbidden dependency -> high
- knip: unused file/dep -> medium (or high if in production path)
- semgrep: use rule-provided severity where available; otherwise map conservatively

---

## 8) Issue creation & lifecycle

### 8.1 Issue policy
Scheduled runs produce Issues for findings meeting thresholds:
- `severity >= severity_threshold`
- `confidence >= confidence_threshold`
- plus max caps: `max_new_per_run`

### 8.2 Issue format (body template)
Every issue should include:

- **Title:** `[vibeCheck] <short title>` (include rule + location)
- **Summary:** 2–5 lines describing why it matters
- **Evidence:** file paths + code region(s) + SARIF link if available
- **Suggested fix:** high-level steps and acceptance criteria
- **Agent instructions:** a short “how to approach with Codex”
- **Fingerprint marker:** hidden marker for dedupe

Example hidden marker:
```
<!-- vibecheck:fingerprint=sha256:abc123... -->
```

### 8.3 Deduping algorithm
Compute fingerprint from:
- normalized `tool`, `ruleId`
- normalized file path(s)
- normalized line region (coarse-grained to avoid churn; e.g., startLine bucketed)
- normalized message (strip numbers that change; collapse whitespace)

Pseudo:
```
key = `${tool}|${ruleId}|${path}|${bucketedLine}|${normalizedMessage}`
fingerprint = sha256(key)
```

### 8.4 Updating existing issues
On each run:
1. Search open issues with label `vibeCheck` (and/or by marker).
2. Build map fingerprint -> issueId.
3. For each finding:
   - if exists: update issue body (refresh evidence/commit/link), add comment if significant change
   - else: create new issue
4. Optionally close resolved:
   - if `close_resolved: true`, close issues whose fingerprint no longer appears for N consecutive runs (prevent flapping).

### 8.5 Labels
Default labels:
- `vibeCheck`
- `severity:high|medium|low|critical`
- `confidence:high|medium|low`
- `layer:code|architecture|system|security`
- tool label: `tool:eslint` etc.
- optionally: `autofix:safe`

---

## 9) GitHub Actions workflows

### 9.1 Reusable scheduled workflow (central repo)
File: `.github/workflows/reusable-analyze.yml`

**Inputs**
- `trunk_arguments` (string)
- `issue_label` (string)
- `config_path` (string, optional; default `vibecheck.yml`)
- `cadence` (string, provided by caller: daily/weekly/monthly)
- `deep_scan` (bool; override)

**Secrets**
- `GH_TOKEN` (required; from caller `GITHUB_TOKEN`)

**Permissions**
- `contents: read`
- `security-events: write` (SARIF upload)
- `issues: write`
- `pull-requests: write` (only if PR commenting is enabled)

**Steps**
1. Checkout
2. Setup Node
3. Load repo config (`vibecheck.yml` if present)
4. Repo detect
5. Run Trunk
6. Run optional extra tools (based on cadence + config)
7. Build SARIF + LLM JSON
8. Upload SARIF (Code Scanning)
9. Create/update issues
10. Upload artifacts (`results.sarif`, `results.llm.json`, logs)

### 9.2 Optional PR workflow (central repo)
File: `.github/workflows/reusable-pr-review.yml`

- Triggered by PR events in runner repos (caller calls it).
- Runs lint in diff mode.
- Uses reviewdog to comment.

### 9.3 Template caller workflow (runner repo)
Located in central repo: `templates/caller-workflow.yml` (copy/paste)

```yaml
name: vibeCheck (Scheduled)

on:
  schedule:
    # Weekly example: Mondays 03:17 UTC
    - cron: "17 3 * * 1"
  workflow_dispatch: {}

jobs:
  vibeCheck:
    uses: <OWNER>/vibeCheck/.github/workflows/reusable-analyze.yml@main
    with:
      cadence: "weekly"           # daily|weekly|monthly
      trunk_arguments: "check"
      issue_label: "vibeCheck"
      config_path: "vibecheck.yml"  # optional; omit if not using
    secrets:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Instructions in template:**
- Replace `<OWNER>` with the GitHub org/user.
- Pin the reusable workflow ref to a tag or commit SHA for stability.
- Choose cron cadence.
- Optional: add a PR workflow call.

---

## 10) Scripts (implementation spec)

### 10.1 `scripts/repo-detect.ts`
Outputs:
- languages (ts/js/etc.)
- package manager (npm/yarn/pnpm/bun)
- monorepo true/false
- workspace package paths (if any)
- flags for tool configs present

### 10.2 `scripts/build-sarif.ts`
Input:
- tool outputs (from Trunk or direct tools)
- optional Trunk JSON output if available

Output:
- `results.sarif`

Implementation details:
- Parse tool outputs into a unified internal `Finding[]` model
- For each finding produce SARIF result:
  - ruleId, message, level, locations
  - include `properties` for confidence/effort/autofix
- Record run metadata: tool versions, invocation info

### 10.3 `scripts/build-llm-json.ts`
Input:
- internal `Finding[]` + `RepoProfile`

Output:
- `results.llm.json`

Implementation details:
- Provide deterministic ordering (sort by severity desc, confidence desc, path, line)
- Provide `suggestedFix` from templates keyed by `tool+ruleId`
- Include acceptance criteria bullets (tests pass, no new lint, duplication reduced, etc.)

### 10.4 `scripts/sarif-to-issues.ts`
Input:
- `results.sarif` or internal `Finding[]` (preferred)
- repo details from GitHub Actions env

Behavior:
- Fetch existing open issues with label(s)
- Compute fingerprints and dedupe
- Create/update issues with required format
- Rate-limit: cap new issues per run
- Emit a summary to logs and to `results.llm.json.summary`

---

## 11) How Codex (or any agent) uses this system

### 11.1 Issue-driven workflow
- Each issue contains:
  - a stable fingerprint marker
  - clear “Suggested fix” steps
  - acceptance criteria
  - minimal but sufficient evidence

### 11.2 Agent loop
1. Pick issue (highest severity/high confidence first)
2. Create branch `vibecheck/<fingerprint-short>/<slug>`
3. Implement fix + add/adjust tests
4. Run local checks (`trunk check`, `pnpm test` etc.)
5. Open PR referencing issue “Fixes #123”
6. Ensure the next scheduled vibeCheck run no longer finds it

### 11.3 Optional automation (future)
- A separate “agent runner” workflow that:
  - pulls `results.llm.json` artifact
  - picks one issue at a time
  - runs an agent to propose PRs
**Out of scope for initial build** (but keep output suitable for it).

---

## 12) Security & permissions

- Prefer using the repo-scoped `GITHUB_TOKEN` rather than a PAT.
- Only require:
  - `security-events: write` (SARIF upload)
  - `issues: write`
  - `contents: read`
- If you later need cross-repo bootstrap automation, consider a PAT with least privilege stored in the central repo secrets, but keep it separate from analysis runs.

---

## 13) Performance strategy (avoid “too slow to use”)

- Scheduled runs: full scan; PR runs: diff-only.
- Use cadence gating:
  - weekly enable jscpd/depcruise
  - monthly enable knip/semgrep deep
- Cache:
  - Node deps (`actions/setup-node` cache)
  - Trunk cache if supported
- Cap issue creation per run; focus on top N issues by severity/confidence.

---

## 14) MVP milestones

### MVP 1 (1–2 repos)
- Central repo with reusable workflow
- Trunk run + minimal output
- Build LLM JSON (even if SARIF is passthrough)
- Create GitHub issues with fingerprints

### MVP 2 (scale & polish)
- SARIF upload to Code Scanning
- Dedupe + issue updates
- Cadence gating (weekly/monthly)
- reviewdog PR workflow (optional)

### MVP 3 (multi-repo bootstrap)
- Script/workflow to install caller workflow into many repos
- Optionally add repo-local `vibecheck.yml` templates

---

## 15) Acceptance criteria

- ✅ Any repo can add 1 workflow file and get scheduled analysis.
- ✅ Results appear in GitHub Code Scanning (SARIF upload).
- ✅ Issues are created for high-confidence findings, deduped and updated across runs.
- ✅ A machine-readable `results.llm.json` is produced and downloadable as an artifact.
- ✅ Repo-specific overrides via `vibecheck.yml` work.
- ✅ Noise is controlled (caps, diff-only PR comments, confidence thresholds).

---

## 16) Deliverables checklist (for the implementing agent)

- [ ] `vibeCheck` central repo created
- [ ] `reusable-analyze.yml` implemented with `workflow_call`
- [ ] `templates/caller-workflow.yml` + docs
- [ ] `config/trunk.yaml` baseline
- [ ] `templates/vibecheck.yml` starter
- [ ] `scripts/repo-detect.ts`
- [ ] `scripts/build-sarif.ts`
- [ ] `scripts/build-llm-json.ts`
- [ ] `scripts/sarif-to-issues.ts` (GH API, dedupe, caps)
- [ ] Unit tests for fingerprinting + scoring
- [ ] End-to-end test in one sample repo
- [ ] README: setup + troubleshooting + customization

---

## 17) README outline (central repo)

- What is vibeCheck?
- Quick start:
  - Copy workflow into target repo
  - Optional add `vibecheck.yml`
- How scheduling works
- How issues are created/updated
- How to tune thresholds
- How to add new tools
- FAQ:
  - SARIF upload permission errors
  - Too many issues created
  - How to suppress a finding
  - Monorepo behavior
