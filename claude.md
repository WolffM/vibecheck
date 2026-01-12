# Claude Code Instructions for vibeCheck

## Local Testing Before GitHub Workflows

**IMPORTANT**: Before pushing any changes that affect issue formatting, fingerprinting, or the analysis pipeline, always run the local test pipeline first.

### Running the Local Test Pipeline

```bash
npx tsx tests/local-preview.ts
```

This script:
1. Runs the full vibeCheck analysis pipeline locally
2. Generates issue preview files in `.vibecheck-test-output/issues/`
3. Creates a summary at `.vibecheck-test-output/issues-summary.md`
4. Performs a **Location Duplication Check** to verify no issues have redundant location information

### What to Verify

After running the local pipeline, check:

1. **No location duplication**: The script will report `✅ PASS - No duplicates` if locations aren't duplicated
2. **Issue formatting**: Review the generated `.md` files in `.vibecheck-test-output/issues/`
3. **Merged findings**: For multi-location findings, verify:
   - The message contains `Found X occurrences across Y files:` with bullet points
   - There is NO separate `## Location` section (would be redundant)
4. **Single-location findings**: Verify they have a proper `## Location` section with GitHub link

### Key Files

- `tests/local-preview.ts` - Local test pipeline
- `src/output/issue-formatter.ts` - Issue body generation (contains `messageContainsLocations()`)
- `src/utils/fingerprints.ts` - Finding merging logic (contains `mergeFindings()`)
- `src/github/sarif-to-issues.ts` - GitHub issue creation/update logic

### Common Issues to Watch For

1. **Location duplication**: If `messageContainsLocations()` regex doesn't match the pattern from `mergeFindings()`, locations appear twice
2. **Long filenames**: Merged semgrep rules create very long rule IDs - filenames are truncated to 50 chars
3. **Severity mapping**: Some tools may have inappropriate severity levels for certain rules

### Only After Local Verification

Once the local pipeline passes:
1. Commit changes
2. Push to trigger the GitHub Actions workflow
3. Check the created issues at <https://github.com/WolffM/vibecheck/issues>
