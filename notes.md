## Steps to reproduce
1. From `/home/runner/work/vibecheck/vibecheck`, install dependencies (`corepack enable && corepack prepare pnpm@9.0.0 --activate && pnpm install --frozen-lockfile`).
2. Run the local reproduction command: `npx tsx tests/local-preview.ts`.
3. Observe that the script runs analysis and generates local preview files, but then continues into GitHub label/issue API operations.
4. In this sandbox, those API calls are blocked and the command exits with a non-zero status.
5. See `trace-local-preview.txt` for a captured execution trace including the failing stack and exit code.

## Observed
The command unexpectedly fails with exit code 1 even though the local preview workflow should be GitHub-safe. The trace shows 403 responses (`Blocked by DNS monitoring proxy`) while calling `/labels` and `/issues`, then reports `Analysis failed`. This indicates local reproduction hits network-dependent issue-processing paths and cannot complete successfully in an offline-restricted environment.

## Expected
`npx tsx tests/local-preview.ts` should complete successfully in local mode and exit with code 0 after generating `.vibecheck-test-output` artifacts. It should not require live GitHub label or issue API calls during a local preview run, and it should remain reproducible in CI-like or sandboxed environments with restricted outbound network access.
