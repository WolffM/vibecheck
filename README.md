# vibeCheck

> Cross-repo static analysis + actionable GitHub issue generator for AI agents

vibeCheck is a **GitHub Action** that runs static analysis on any repository and turns findings into **actionable GitHub Issues** designed to be resolved by AI coding agents.

**[📋 See Example Issues](https://github.com/WolffM/vibecheck/issues?q=is%3Aissue+label%3AvibeCheck)** - Live demo of what vibeCheck creates

## Features

- 🔍 **Multi-language analysis**: JavaScript/TypeScript, Python, and Java
- 🛠️ **JS/TS tools**: Trunk, TypeScript, ESLint, jscpd, dependency-cruiser, knip, Semgrep
- 🐍 **Python tools**: Ruff (linting), Mypy (types), Bandit (security)
- ☕ **Java tools**: PMD (code analysis), SpotBugs (bytecode bugs)
- 📊 **SARIF output**: Results appear in GitHub Code Scanning
- 🤖 **AI-friendly issues**: Structured with suggested fixes and acceptance criteria
- 🔁 **Deduplication**: Stable fingerprints prevent duplicate issues across runs
- 🔄 **Auto-cleanup**: Closes resolved and duplicate issues automatically
- ⚙️ **Configurable**: Per-repo overrides via `vibecheck.yml`
- 📅 **Cadence-aware**: Schedule heavy tools for weekly/monthly runs only

## Quick Start

Choose your preferred installation method:

### Option 1: One-Click Install (Recommended)

**[Add vibeCheck to your repo](https://wolffm.github.io/vibecheck/install)** - Enter your repo name and click to create the workflow file.

### Option 2: Direct URL

Replace `OWNER/REPO` with your repository and open this URL:

```
https://github.com/OWNER/REPO/new/main?filename=.github/workflows/vibecheck.yml&value=name%3A%20vibeCheck%20Analysis%0A%0Aon%3A%0A%20%20schedule%3A%0A%20%20%20%20-%20cron%3A%20%220%203%20*%20*%201%22%0A%20%20workflow_dispatch%3A%0A%20%20%20%20inputs%3A%0A%20%20%20%20%20%20cadence%3A%0A%20%20%20%20%20%20%20%20description%3A%20%22Analysis%20cadence%22%0A%20%20%20%20%20%20%20%20default%3A%20%22weekly%22%0A%20%20%20%20%20%20%20%20type%3A%20choice%0A%20%20%20%20%20%20%20%20options%3A%20%5Bdaily%2C%20weekly%2C%20monthly%5D%0A%0Apermissions%3A%0A%20%20contents%3A%20read%0A%20%20issues%3A%20write%0A%20%20security-events%3A%20write%0A%0Ajobs%3A%0A%20%20analyze%3A%0A%20%20%20%20runs-on%3A%20ubuntu-latest%0A%20%20%20%20steps%3A%0A%20%20%20%20%20%20-%20uses%3A%20actions%2Fcheckout%40v4%0A%20%20%20%20%20%20%20%20with%3A%0A%20%20%20%20%20%20%20%20%20%20fetch-depth%3A%200%0A%20%20%20%20%20%20-%20uses%3A%20WolffM%2Fvibecheck%40main%0A%20%20%20%20%20%20%20%20with%3A%0A%20%20%20%20%20%20%20%20%20%20github_token%3A%20%24%7B%7B%20secrets.GITHUB_TOKEN%20%7D%7D%0A%20%20%20%20%20%20%20%20%20%20cadence%3A%20%24%7B%7B%20inputs.cadence%20%7C%7C%20%27weekly%27%20%7D%7D
```

This opens GitHub's file editor with the workflow pre-filled. Just click **"Commit changes"**.

### Option 3: Copy the Template

1. Copy [`.github/workflows/vibecheck.yml`](.github/workflows/vibecheck.yml) from this repo
2. Add it to your repo at the same path
3. Commit and push

Or create `.github/workflows/vibecheck.yml` manually:

```yaml
name: vibeCheck Analysis

on:
  schedule:
    - cron: "0 3 * * 1" # Weekly on Mondays at 3am UTC
  workflow_dispatch: {} # Manual trigger button

permissions:
  contents: read
  issues: write
  security-events: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: WolffM/vibecheck@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

---

**That's it!** The workflow will:

- Run automatically every Monday at 3am UTC
- Can be triggered manually from the Actions tab
- Uses your repo's built-in `GITHUB_TOKEN` (no secrets to configure)

### Trigger it manually (optional)

1. Go to your repo's **Actions** tab
2. Click **vibeCheck Analysis** in the sidebar
3. Click **Run workflow**

---

## Configuration Options

### Workflow Inputs

Customize the action in your workflow file:

```yaml
- uses: WolffM/vibecheck@main
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    cadence: "weekly" # daily | weekly | monthly
    severity_threshold: "low" # critical | high | medium | low | info
    confidence_threshold: "medium" # high | medium | low
    merge_strategy: "same-linter" # none | same-file | same-rule | same-linter | same-tool
    skip_issues: "false" # true to do a dry run
```

| Input                  | Description                       | Default       |
| ---------------------- | --------------------------------- | ------------- |
| `github_token`         | GitHub token (auto-provided)      | **Required**  |
| `cadence`              | How often heavy tools run         | `weekly`      |
| `severity_threshold`   | Min severity for issues           | `info`        |
| `confidence_threshold` | Min confidence for issues         | `low`         |
| `merge_strategy`       | How to group findings into issues | `same-linter` |
| `skip_issues`          | Skip issue creation (dry run)     | `false`       |

### Per-Repo Configuration (Optional)

For fine-tuned control, create `vibecheck.yml` at your repository root:

```yaml
version: 1

issues:
  severity_threshold: "medium" # Only medium+ severity
  confidence_threshold: "high" # Only high confidence
  max_new_per_run: 10 # Limit new issues per run
  close_resolved: true # Auto-close fixed issues

tools:
  jscpd:
    enabled: false # Disable duplicate detection
  semgrep:
    enabled: true # Always run security scanning
  knip:
    enabled: weekly # Run unused code detection weekly
```

---

## How It Works

### Analysis Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Repo       │───▶│  Trunk +    │───▶│  Normalize  │───▶│  Create     │
│  Detection  │    │  Tools      │    │  Findings   │    │  Issues     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                          │                  │
                          ▼                  ▼
                   ┌─────────────┐    ┌─────────────┐
                   │  SARIF      │    │  LLM JSON   │
                   │  (Code Scan)│    │  (Artifacts)│
                   └─────────────┘    └─────────────┘
```

### Issue Lifecycle

1. **Creation**: Issues are created for findings meeting thresholds
2. **Deduplication**: Fingerprints prevent duplicates across runs
3. **Updates**: Existing issues get refreshed with latest evidence
4. **Closure**: (Optional) Issues auto-close after N runs without the finding

### Fingerprinting

Findings are fingerprinted using:

- Tool name
- Rule ID
- File path
- Line number (bucketed to ±20 lines)
- Normalized message

This allows vibeCheck to track issues across minor code changes.

## Configuration Reference

### Workflow Inputs

| Input             | Default       | Description                                      |
| ----------------- | ------------- | ------------------------------------------------ |
| `cadence`         | `weekly`      | Analysis frequency: `daily`, `weekly`, `monthly` |
| `trunk_arguments` | `check`       | Arguments for Trunk                              |
| `issue_label`     | `vibeCheck`     | Primary label for issues                         |
| `config_path`     | `vibecheck.yml` | Path to config file                              |
| `skip_issues`     | `false`       | Skip issue creation                              |

### vibecheck.yml Schema

```yaml
version: 1

schedule:
  cadence: weekly # Caller workflow controls actual schedule
  deep_scan: false # Enable all tools regardless of cadence

trunk:
  enabled: true
  arguments: "check"

tools:
  tsc:
    enabled: auto # auto | true | false | daily | weekly | monthly
  eslint:
    enabled: auto
  prettier:
    enabled: auto
  jscpd:
    enabled: weekly
    min_tokens: 70
    threshold: 1
  dependency_cruiser:
    enabled: weekly
  knip:
    enabled: monthly
  semgrep:
    enabled: monthly
    config: "p/default"

issues:
  enabled: true
  label: "vibeCheck"
  max_new_per_run: 25
  severity_threshold: "medium" # Minimum severity
  confidence_threshold: "high" # Minimum confidence
  close_resolved: false # Auto-close when finding disappears
  assignees: []

output:
  sarif: true
  llm_json: true
  artifact_retention_days: 14

llm:
  agent_hint: "codex"
  pr_branch_prefix: "vibecheck/"
```

## Tool Enablement

Tools can be enabled with:

- `true` / `false`: Always on/off
- `auto`: Run if config file detected (e.g., `eslintrc`, `tsconfig.json`)
- `daily` / `weekly` / `monthly`: Run only on that cadence or slower

### JavaScript/TypeScript Tools

| Tool               | Default | Detects                  |
| ------------------ | ------- | ------------------------ |
| Trunk              | enabled | Always                   |
| TypeScript         | auto    | `tsconfig.json`          |
| ESLint             | auto    | ESLint config files      |
| Prettier           | auto    | Prettier config files    |
| jscpd              | weekly  | Always (on weekly+)      |
| dependency-cruiser | weekly  | `.dependency-cruiser.js` |
| knip               | monthly | `knip.json`              |
| semgrep            | weekly  | Always (security scan)   |

### Python Tools

| Tool   | Default | Detects                              | Purpose           |
| ------ | ------- | ------------------------------------ | ----------------- |
| ruff   | daily   | `pyproject.toml`, `requirements.txt` | Fast linting      |
| mypy   | daily   | Python project files                 | Type checking     |
| bandit | weekly  | Python project files                 | Security scanning |

### Java Tools

| Tool     | Default | Detects                   | Purpose           |
| -------- | ------- | ------------------------- | ----------------- |
| PMD      | weekly  | `pom.xml`, `build.gradle` | Code analysis     |
| SpotBugs | monthly | Compiled `.class` files   | Bytecode analysis |

## Severity & Confidence

### Severity Levels

| Level      | Description                                           |
| ---------- | ----------------------------------------------------- |
| `critical` | Security vulnerabilities, data loss risks             |
| `high`     | Type errors, circular dependencies, forbidden imports |
| `medium`   | Code smells, unused code, complexity                  |
| `low`      | Style issues, minor suggestions                       |

### Confidence Levels

| Level    | Description                                     |
| -------- | ----------------------------------------------- |
| `high`   | Definite issues (type errors, exact duplicates) |
| `medium` | Likely issues, may need context                 |
| `low`    | Suggestions, style preferences                  |

### Default Thresholds

Issues are created when:

- `severity >= medium` AND `confidence >= high`

Adjust with `issues.severity_threshold` and `issues.confidence_threshold`.

## Issue Format

Issues created by vibeCheck include:

- **Summary**: Tool, rule, severity, confidence
- **Location**: File path and line numbers
- **Evidence**: Code snippets when available
- **Suggested Fix**: Goal, steps, acceptance criteria
- **Agent Instructions**: Branch naming, workflow hints
- **Fingerprint**: Hidden marker for deduplication

Example issue body:

```markdown
## Summary

**Tool:** `eslint`
**Rule:** `no-unused-vars`
**Severity:** medium
**Confidence:** high
**Effort:** S

Variable 'x' is declared but never used.

## Location

`src/utils/helper.ts` (line 42)

## Suggested Fix

**Goal:** Remove unused variable declarations

**Steps:**

1. Identify the unused variable from the error message
2. Determine if it should be removed or if it reveals missing functionality
3. Remove the variable declaration if unused

**Acceptance Criteria:**

- [ ] No unused variable warnings in affected file
- [ ] Tests continue to pass
```

## Output Artifacts

Each run produces:

| File               | Description                          |
| ------------------ | ------------------------------------ |
| `results.sarif`    | SARIF 2.1.0 for GitHub Code Scanning |
| `results.llm.json` | Structured findings for AI agents    |
| `findings.json`    | Raw findings array                   |
| `context.json`     | Run context and repo profile         |

### LLM JSON Schema

```json
{
  "version": 1,
  "repo": { "owner": "...", "name": "...", "commit": "..." },
  "summary": {
    "totalFindings": 42,
    "highConfidence": 10,
    "actionable": 8
  },
  "findings": [
    {
      "fingerprint": "sha256:...",
      "tool": "eslint",
      "ruleId": "no-unused-vars",
      "severity": "medium",
      "confidence": "high",
      "effort": "S",
      "locations": [{ "path": "...", "startLine": 42 }],
      "suggestedFix": {
        "goal": "...",
        "steps": ["..."],
        "acceptance": ["..."]
      }
    }
  ]
}
```

## AI Agent Integration

### Issue-Driven Workflow

1. Agent picks highest-priority issue (severity × confidence × effort)
2. Creates branch: `vibecheck/<fingerprint>/<rule-slug>`
3. Implements suggested fix
4. Runs `trunk check` and tests
5. Opens PR: "Fixes #123"

### Using LLM JSON

Download the artifact and process programmatically:

```typescript
const results = await fetchArtifact("vibecheck-results");
const llmJson = JSON.parse(results["results.llm.json"]);

// Pick actionable findings sorted by priority
const actionable = llmJson.findings
  .filter((f) => f.confidence === "high")
  .sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);

// Work through issues
for (const finding of actionable) {
  await agent.fix(finding);
}
```

## FAQ

### SARIF upload permission errors

Ensure your workflow has `security-events: write` permission:

```yaml
permissions:
  contents: read
  security-events: write
  issues: write
```

### Too many issues created

Reduce noise by:

1. Increasing `severity_threshold` to `high`
2. Reducing `max_new_per_run`
3. Disabling noisy tools

### How to suppress a finding

Options:

1. Fix the issue (recommended)
2. Add inline suppression comment (tool-specific)
3. Configure tool to ignore the rule
4. Add path to tool's ignore list

### Monorepo behavior

vibeCheck detects monorepos via:

- `pnpm-workspace.yaml`
- `package.json` workspaces
- `turbo.json` / `nx.json` / `lerna.json`

Analysis runs at the repo root and covers all packages.

### Rate limiting

vibeCheck respects GitHub API limits:

- Issues are capped at `max_new_per_run` per execution
- API calls include small delays
- Use `GITHUB_TOKEN` (not PAT) for repo-scoped limits

## Development

### Local Setup

```bash
# Clone the repo
git clone https://github.com/<OWNER>/vibeCheck.git
cd vibeCheck

# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm typecheck
```

### Running Locally

```bash
# Analyze a target repo
npx tsx scripts/analyze.ts --root /path/to/repo --cadence weekly --skip-issues
```

### Scripts

| Script               | Description                 |
| -------------------- | --------------------------- |
| `analyze.ts`         | Main orchestrator           |
| `repo-detect.ts`     | Detect repo profile         |
| `build-sarif.ts`     | Generate SARIF output       |
| `build-llm-json.ts`  | Generate LLM JSON output    |
| `sarif-to-issues.ts` | Create/update GitHub issues |

## License

MIT
