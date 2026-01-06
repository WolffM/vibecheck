# Test Fixtures

This directory contains intentionally "dirty" code to demonstrate all vibeCop analysis tools.
These files trigger at least one issue per tool, which remain open as demo issues in this repo.

All findings from test-fixtures are labeled with `demo` and merged separately from real repository issues.

## Files and What They Test

| File                                          | Tool(s)                | Issues                                                        |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| `markdown-issues.md`                          | **Trunk/markdownlint** | Heading format, line length, blank lines                      |
| `yaml-issues.yaml`                            | **Trunk/yamllint**     | Indentation, duplicate keys, truthy values                    |
| `duplicate-code-a.ts` + `duplicate-code-b.ts` | **jscpd**              | ~60 lines of duplicated validation code                       |
| `circular-dep-a.ts` + `circular-dep-b.ts`     | **dependency-cruiser** | Circular import dependency                                    |
| `unused-exports.ts`                           | **knip**               | Exported but never imported functions, classes, types         |
| `security-issues.ts`                          | **Semgrep**            | `eval()`, command injection patterns                          |
| `eslint-issues.ts`                            | **Trunk/eslint**       | Unused variables, any types, console statements               |
| `ruff-issues.py`                              | **Ruff**               | Style violations, unused imports, bad naming                  |
| `mypy-issues.py`                              | **Mypy**               | Type mismatches, missing returns, protocol violations         |
| `bandit-issues.py`                            | **Bandit**             | SQL injection, hardcoded secrets, insecure functions          |
| `PmdIssues.java`                              | **PMD**                | Empty catch blocks, unused vars, complexity issues            |
| `SpotBugsIssues.java`                         | **SpotBugs** (\*)      | Null deref, resource leaks, thread safety bugs                |
| `typescript-errors.ts`                        | (excluded)             | TypeScript demo - excluded from tsc to prevent build failures |

(\*) SpotBugs requires compiled .class files and won't produce findings without a Java build system.

## Tool Coverage Summary

| Tool                   | Findings    | Cadence | Description                              |
| ---------------------- | ----------- | ------- | ---------------------------------------- |
| **Trunk**              | ✅ Multiple | daily   | markdownlint, yamllint, prettier, eslint |
| **jscpd**              | ✅ 1+       | weekly  | Duplicate code blocks                    |
| **dependency-cruiser** | ✅ 1        | weekly  | Circular dependency                      |
| **knip**               | ✅ Multiple | weekly  | Unused exports and dependencies          |
| **Semgrep**            | ✅ 1+       | weekly  | Security vulnerabilities                 |
| **Ruff**               | ✅ Multiple | daily   | Python linting (fast)                    |
| **Mypy**               | ✅ Multiple | daily   | Python type checking                     |
| **Bandit**             | ✅ Multiple | weekly  | Python security scanning                 |
| **PMD**                | ✅ Multiple | weekly  | Java static code analysis                |
| **SpotBugs**           | ⚠️ Skipped  | monthly | Requires compiled .class files           |

## Notes

- **tsc**: TypeScript errors in test-fixtures are excluded from tsconfig.json to prevent build failures. Real tsc issues come from actual project code.
- **SpotBugs**: Requires compiled Java bytecode. Since we don't have a build system (Maven/Gradle), SpotBugs cannot analyze the demo Java files.
- **Demo separation**: All test-fixtures findings are prefixed with `demo|` in merge keys and labeled with `demo` to keep them separate from real repository issues.

## Running Analysis

```bash
# Quick verbose analysis (shows all findings)
npx tsx scripts/verbose-analyze.ts --root="."

# With severity filter
npx tsx scripts/verbose-analyze.ts --severity-threshold=high

# With different merge strategy
npx tsx scripts/verbose-analyze.ts --merge-strategy=same-file
```

## Demo Issues

When vibeCop runs on this repo, it creates GitHub issues for each finding.
These issues serve as:

1. **Demos** - Show what vibeCop-created issues look like
2. **Test targets** - AI agents can practice fixing them
3. **Documentation** - Each issue explains the problem and fix

Issues are labeled with `vibeCop` and include:

- Severity and confidence ratings
- All affected file locations (merged)
- Agent instructions with branch naming
- Fingerprint for deduplication
