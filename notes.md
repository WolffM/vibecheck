## Steps to reproduce
1. Open a shell in the project root directory (for this run: `/home/runner/work/vibecheck/vibecheck`).
2. Install dependencies with `npm install` (if not already installed).
3. Run `npm run lint`.
4. Optionally review the saved failure trace in `repro-trace.txt`.

## Observed
The lint command fails consistently instead of completing successfully. The trace shows three errors, including `@typescript-eslint/no-empty-object-type` in `src/core/types.ts` and `no-useless-escape` in `src/utils/fingerprints.ts`. Because lint exits non-zero, quality checks fail before any subsequent validation steps. A full command trace demonstrating the failure is included in `repro-trace.txt`.

## Expected
`npm run lint` should complete without lint errors and return exit code 0, so the repository can pass local quality checks and CI lint stages. The run should not block contributors from validating changes unrelated to these files.
