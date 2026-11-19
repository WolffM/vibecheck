# vibeCheck

**Guide:** [overview](docs/guide/index.md) · [features](docs/guide/features.md) · [contributing](docs/guide/contributing.md) · [history](docs/guide/history.md) · [trivia](docs/guide/trivia.md)

> Cross-repo static analysis + actionable GitHub issue generator for AI agents

vibeCheck is a **GitHub Action** that runs static analysis on any repository and turns findings into **actionable GitHub Issues** designed to be resolved by AI coding agents. A second mode, vibeCompact, runs a slower code-quality audit instead — see the guide's [features](docs/guide/features.md) for both.

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
          # severity_threshold: "medium"  # default, adjust as needed
          # confidence_threshold: "low"   # default
```

---

**That's it!** To run vibeCheck:

1. Go to your repo's **Actions** tab
2. Click **vibeCheck** in the sidebar
3. Click **Run workflow**

No secrets to configure—uses your repo's built-in `GITHUB_TOKEN`.

### Audit mode (vibeCompact)

The snippet above is **analyze mode**. Audit mode has a different workflow,
runner and delivery semantics — copy the canonical file instead of
hand-writing one: [`starter-workflow/vibecompact.yml`](starter-workflow/vibecompact.yml).
Its delivery (episodic findings PRs, when a protected branch applies, and
how to disable them) is in the guide's
[vibeCompact audit](docs/guide/features.md#the-vibecompact-audit).

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
    skip_issues: "false"            # true for dry run
    vibecheck_github_package_token: ${{ secrets.GITHUB_TOKEN }}  # Optional: for private packages
```

| Input                            | Description                                           | Default    |
| -------------------------------- | ----------------------------------------------------- | ---------- |
| `github_token`                   | GitHub token for issue management                     | *Required* |
| `severity_threshold`             | Min severity for issues                               | `medium`   |
| `confidence_threshold`           | Min confidence for issues                             | `low`      |
| `skip_issues`                    | Skip issue creation (dry run)                         | `false`    |
| `create_config_pr`               | Create PR with generated configs                      | `false`    |
| `vibecheck_github_package_token` | Token for private GitHub packages (e.g., `@org/pkg`)  | `""`       |

### Private Package Support

If your repository uses private packages from GitHub Package Registry (e.g., `@yourorg/private-package`), vibeCheck needs authentication to install them. Add the `packages: read` permission and pass the token:

```yaml
permissions:
  contents: read
  issues: write
  security-events: write
  packages: read        # Required for private packages

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: WolffM/vibecheck@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          vibecheck_github_package_token: ${{ secrets.GITHUB_TOKEN }}
```

**Note:** vibeCheck will continue running even if dependency installation fails. Tools that require dependencies (ESLint, TypeScript) will be gracefully skipped and noted in the results.

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
  opengrep:
    enabled: true # Always run security scanning
  knip:
    enabled: weekly # Run unused code detection weekly
```

Too many issues on a noisy repo? Raise `severity_threshold` to `high`,
lower `max_new_per_run`, or disable a noisy tool above.

## License

MIT
