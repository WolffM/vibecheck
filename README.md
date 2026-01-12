# vibeCheck

> Cross-repo static analysis + actionable GitHub issue generator for AI agents

vibeCheck is a **GitHub Action** that runs static analysis on any repository and turns findings into **actionable GitHub Issues** designed to be resolved by AI coding agents.

| Example Issues |
|:---:|
| [![All](https://img.shields.io/badge/All-vibeCheck-7c3aed)](https://github.com/WolffM/vibecheck/issues?q=is%3Aissue+is%3Aopen+label%3AvibeCheck) [![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://github.com/WolffM/vibecheck/issues?q=is%3Aissue+is%3Aopen+label%3AvibeCheck+label%3Alang%3Atypescript) [![Python](https://img.shields.io/badge/Python-3776ab?logo=python&logoColor=white)](https://github.com/WolffM/vibecheck/issues?q=is%3Aissue+is%3Aopen+label%3AvibeCheck+label%3Alang%3Apython) [![Java](https://img.shields.io/badge/Java-b07219?logo=openjdk&logoColor=white)](https://github.com/WolffM/vibecheck/issues?q=is%3Aissue+is%3Aopen+label%3AvibeCheck+label%3Alang%3Ajava) [![Rust](https://img.shields.io/badge/Rust-dea584?logo=rust&logoColor=black)](https://github.com/WolffM/vibecheck/issues?q=is%3Aissue+is%3Aopen+label%3AvibeCheck+label%3Alang%3Arust) |

## Quick Start

### One-Click Install (Recommended)

**[Add vibeCheck to your repo](https://wolffm.github.io/vibecheck/install)** - Enter your repo name and create a PR with the workflow file.

### Manual Setup

Create `.github/workflows/vibecheck.yml` in your repo:

```yaml
name: vibeCheck

on:
  workflow_dispatch: # Manual trigger via Actions tab

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
          severity_threshold: "low"
          confidence_threshold: "medium"
```

---

**That's it!** To run vibeCheck:

1. Go to your repo's **Actions** tab
2. Click **vibeCheck** in the sidebar
3. Click **Run workflow**

No secrets to configure—uses your repo's built-in `GITHUB_TOKEN`.

---

## Configuration

### Workflow Inputs

Customize the action in your workflow file:

```yaml
- uses: WolffM/vibecheck@main
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    severity_threshold: "medium"    # info | low | medium | high | critical
    confidence_threshold: "medium"  # low | medium | high
    merge_strategy: "same-rule"     # none | same-file | same-rule
    skip_issues: "false"            # true for dry run
```

| Input                  | Description                       | Default     |
| ---------------------- | --------------------------------- | ----------- |
| `github_token`         | GitHub token for issue management | *Required*  |
| `severity_threshold`   | Min severity for issues           | `low`       |
| `confidence_threshold` | Min confidence for issues         | `medium`    |
| `merge_strategy`       | How to group findings into issues | `same-rule` |
| `skip_issues`          | Skip issue creation (dry run)     | `false`     |
| `create_config_pr`     | Create PR with generated configs  | `false`     |

### Auto-commit Config Files (Optional)

On first run, vibeCheck generates config files (`.trunk/`, etc.) that are lost after the workflow ends. 
To persist these and speed up future runs, enable `create_config_pr`:

```yaml
permissions:
  contents: write        # Required for pushing branch
  pull-requests: write   # Required for creating PR
  issues: write
  security-events: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: WolffM/vibecheck@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          create_config_pr: "true"  # Creates PR with .trunk/ etc.
```

This creates a one-time PR adding the config files to your repo.

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

```text
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

## Tools

### JavaScript/TypeScript

| Tool               | Purpose                    |
| ------------------ | -------------------------- |
| Trunk              | Meta-linter (ESLint, etc.) |
| TypeScript (tsc)   | Type checking              |
| jscpd              | Duplicate code detection   |
| dependency-cruiser | Circular dependencies      |
| knip               | Unused exports/files       |
| Semgrep            | Security scanning          |

### Python

| Tool   | Purpose           |
| ------ | ----------------- |
| Ruff   | Fast linting      |
| Mypy   | Type checking     |
| Bandit | Security scanning |

### Java

| Tool     | Purpose                |
| -------- | ---------------------- |
| PMD      | Code analysis          |
| SpotBugs | Bytecode bug detection |

### Rust

| Tool        | Purpose                      |
| ----------- | ---------------------------- |
| Clippy      | Linting (750+ lints)         |
| cargo-audit | Dependency vulnerabilities   |
| cargo-deny  | Licenses, bans, advisories   |

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

The install page defaults to `severity >= low` and `confidence >= medium` to reduce noise. Adjust as needed.

## Issue Format

Each issue includes:
- Summary with tool, rule, severity, and confidence
- File location with clickable GitHub links
- Code snippets as evidence
- Suggested fix with acceptance criteria
- Hidden fingerprint for deduplication

## Output Artifacts

| File               | Description                          |
| ------------------ | ------------------------------------ |
| `results.sarif`    | SARIF 2.1.0 for GitHub Code Scanning |
| `results.llm.json` | Structured findings for AI agents    |

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

```bash
git clone https://github.com/WolffM/vibecheck.git
cd vibecheck
pnpm install
pnpm test
```

## License

MIT
