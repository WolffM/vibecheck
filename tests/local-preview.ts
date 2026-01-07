/**
 * Local Issue Output Tester
 * 
 * This script runs the vibeCheck analysis pipeline locally and outputs
 * the issue bodies that WOULD be created, without touching GitHub.
 * 
 * Usage: npx tsx tests/local-preview.ts
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../src/core/analyze.js";
import {
  generateIssueBody,
  generateIssueTitle,
  getLabelsForFinding,
  detectLanguagesInFindings,
} from "../src/output/issue-formatter.js";

interface IssuePreview {
  number: number;
  title: string;
  labels: string[];
  body: string;
  finding: {
    tool: string;
    ruleId: string;
    severity: string;
    locationCount: number;
    files: string[];
  };
}

async function main() {
  const outputDir = join(process.cwd(), ".vibecheck-test-output");
  
  // Clean up previous test output
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  
  // Create fresh output directory
  mkdirSync(outputDir, { recursive: true });

  console.log("=== Local Issue Output Tester ===\n");

  // Set mock environment variables to simulate GitHub Actions
  process.env.GITHUB_REPOSITORY_OWNER = "WolffM";
  process.env.GITHUB_REPOSITORY = "WolffM/vibecheck";
  process.env.GITHUB_SHA = "abc123def456789";
  process.env.GITHUB_RUN_NUMBER = "999";

  // Run analysis with skip-issues to avoid touching GitHub
  console.log("Running analysis (skip-issues mode)...\n");
  
  const result = await analyze({
    rootPath: process.cwd(),
    cadence: "weekly",
    skipIssues: true,
    severityThreshold: "low",
    confidenceThreshold: "medium",
    mergeStrategy: "same-linter",
    outputDir,
  });

  console.log(`\nGenerating issue previews for ${result.findings.length} merged findings...\n`);

  // Detect languages for conditional labeling
  const languagesInRun = detectLanguagesInFindings(result.findings);

  // Generate issue previews
  const previews: IssuePreview[] = result.findings.map((finding, index) => {
    const title = generateIssueTitle(finding);
    const body = generateIssueBody(finding, result.context);
    const labels = getLabelsForFinding(finding, "vibeCheck", languagesInRun);
    const uniqueFiles = [...new Set(finding.locations.map(l => l.path))];

    return {
      number: index + 1,
      title,
      labels,
      body,
      finding: {
        tool: finding.tool,
        ruleId: finding.ruleId,
        severity: finding.severity,
        locationCount: finding.locations.length,
        files: uniqueFiles,
      },
    };
  });

  // Write individual issue files
  const issuesDir = join(outputDir, "issues");
  if (!existsSync(issuesDir)) {
    mkdirSync(issuesDir, { recursive: true });
  }

  for (const preview of previews) {
    // Truncate rule ID to avoid super long filenames (Windows path limit)
    const safeRuleId = preview.finding.ruleId.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const filename = `issue-${String(preview.number).padStart(3, "0")}-${preview.finding.tool}-${safeRuleId}.md`;
    const filepath = join(issuesDir, filename);
    
    const content = `# ${preview.title}

**Labels:** ${preview.labels.join(", ")}

**Tool:** ${preview.finding.tool}
**Rule:** ${preview.finding.ruleId}
**Severity:** ${preview.finding.severity}
**Locations:** ${preview.finding.locationCount} across ${preview.finding.files.length} file(s)
**Files:** 
${preview.finding.files.map(f => `- ${f}`).join("\n")}

---

${preview.body}
`;
    
    writeFileSync(filepath, content);
  }

  // Write summary
  const summaryPath = join(outputDir, "issues-summary.md");
  const summary = `# Issue Preview Summary

Generated: ${new Date().toISOString()}

## Statistics

- Total findings (raw): ${result.stats.totalFindings}
- Unique findings: ${result.stats.uniqueFindings}  
- Merged findings (issues): ${result.stats.mergedFindings}

## By Tool

${Object.entries(result.stats.byTool).map(([tool, count]) => `- ${tool}: ${count}`).join("\n")}

## Issues That Would Be Created

| # | Tool | Rule | Severity | Locations | Files |
|---|------|------|----------|-----------|-------|
${previews.map(p => `| ${p.number} | ${p.finding.tool} | ${p.finding.ruleId} | ${p.finding.severity} | ${p.finding.locationCount} | ${p.finding.files.length} |`).join("\n")}

## Issue Files

${previews.map(p => {
  const safeRuleId = p.finding.ruleId.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
  return `- [Issue ${p.number}](issues/issue-${String(p.number).padStart(3, "0")}-${p.finding.tool}-${safeRuleId}.md): ${p.title}`;
}).join("\n")}
`;

  writeFileSync(summaryPath, summary);

  console.log("=== Output Generated ===\n");
  console.log(`Summary: ${summaryPath}`);
  console.log(`Issues directory: ${issuesDir}`);
  console.log(`\nGenerated ${previews.length} issue preview files.`);
  
  // Print quick validation check for location duplication
  console.log("\n=== Location Duplication Check ===\n");
  
  let duplicateCount = 0;
  for (const preview of previews) {
    // Check if body has both "Found X occurrences" AND "## Location" section
    const hasFoundOccurrences = /Found \d+ occurrences?/i.test(preview.body);
    const hasLocationSection = /## Location\n/i.test(preview.body);
    
    if (hasFoundOccurrences && hasLocationSection) {
      console.log(`⚠️  DUPLICATE: Issue ${preview.number} (${preview.finding.tool}:${preview.finding.ruleId}) has BOTH occurrence list AND Location section`);
      duplicateCount++;
    } else if (hasFoundOccurrences) {
      console.log(`✅ Issue ${preview.number}: Uses occurrence list (no Location section) - ${preview.finding.locationCount} locations`);
    } else if (hasLocationSection) {
      console.log(`✅ Issue ${preview.number}: Uses Location section (no occurrence list) - ${preview.finding.locationCount} locations`);
    } else {
      console.log(`❓ Issue ${preview.number}: No location info found`);
    }
  }

  console.log(`\n=== Result: ${duplicateCount === 0 ? "✅ PASS - No duplicates" : `❌ FAIL - ${duplicateCount} issues with duplicate locations`} ===`);
}

main().catch(console.error);
