## Steps to reproduce
1. Open the repository at `/home/runner/work/vibecheck/vibecheck`.
2. Install dependencies with `npm install`.
3. Run duplicate-code detection directly against the two files from the issue:
   - `npx jscpd src/ado/findings-to-workitems.ts src/github/sarif-to-issues.ts`
4. Review the clone report and line ranges in the command output.

## Observed
`jscpd` reports duplicate blocks between `src/ado/findings-to-workitems.ts` and `src/github/sarif-to-issues.ts`. It flags the issue-config merge logic and threshold filtering logic as clones. The trace identifies matching ranges around lines 63–75 and 70–82, and another block around the threshold filtering sections. This confirms the duplication finding is reproducible from a clean local run.

## Expected
Shared logic should be factored into common helpers so the two processors do not duplicate identical code blocks. The duplicate-code scan should no longer report these repeated sections across the ADO and GitHub issue/work-item orchestration files.
