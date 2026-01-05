/**
 * Verbose Analysis Runner
 *
 * Runs all analysis tools and outputs their raw results to separate files.
 * Also generates a preview of what GitHub issues would be created.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { detectRepo } from "./repo-detect.js";
import {
  deduplicateFindings,
  mergeIssues,
  type MergeStrategy,
} from "./fingerprints.js";
import {
  parseTscTextOutput,
  parseTscOutput,
  parseJscpdOutput,
  parseTrunkOutput,
  parseDepcruiseOutput,
  parseKnipOutput,
  parseSemgrepOutput,
} from "./parsers.js";
import type { Finding } from "./types.js";

interface ToolResult {
  tool: string;
  rawOutput: string;
  jsonOutput: unknown;
  findings: Finding[];
  error?: string;
}

// ============================================================================
// Tool Runners with Raw Output Capture
// ============================================================================

function runTrunkVerbose(rootPath: string): ToolResult {
  console.log("\n📋 Running Trunk...");

  try {
    const versionCheck = spawnSync("pnpm", ["exec", "trunk", "--version"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.status !== 0) {
      return {
        tool: "trunk",
        rawOutput: "",
        jsonOutput: null,
        findings: [],
        error: "Not installed",
      };
    }

    const result = spawnSync(
      "pnpm",
      ["exec", "trunk", "check", "--all", "--output=json", "--no-progress"],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    const rawOutput = result.stdout || "";
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}(?=\s*$)/);

    if (jsonMatch) {
      const jsonOutput = JSON.parse(jsonMatch[0]);
      const findings = parseTrunkOutput(jsonOutput);
      return { tool: "trunk", rawOutput, jsonOutput, findings };
    }

    return {
      tool: "trunk",
      rawOutput,
      jsonOutput: null,
      findings: [],
      error: "No JSON output",
    };
  } catch (error) {
    return {
      tool: "trunk",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: String(error),
    };
  }
}

function runTscVerbose(rootPath: string): ToolResult {
  console.log("\n📋 Running TypeScript...");

  try {
    const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
    });

    const rawOutput = result.stdout + result.stderr;
    const diagnostics = parseTscTextOutput(rawOutput);
    const findings = parseTscOutput(diagnostics);

    return { tool: "tsc", rawOutput, jsonOutput: diagnostics, findings };
  } catch (error) {
    return {
      tool: "tsc",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: String(error),
    };
  }
}

// NOTE: ESLint is handled by Trunk, so we skip it in verbose analysis
// to avoid duplicate findings. Trunk runs ESLint internally.

function runJscpdVerbose(rootPath: string, outputDir: string): ToolResult {
  console.log("\n📋 Running jscpd...");

  try {
    const jscpdOutputDir = join(outputDir, "jscpd-raw");
    mkdirSync(jscpdOutputDir, { recursive: true });

    spawnSync(
      "npx",
      [
        "jscpd",
        ".",
        "--min-tokens=50",
        "--min-lines=5",
        "--reporters=json",
        `--output=${jscpdOutputDir}`,
        '--ignore="**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/.vibecop-output/**,**/.vibecop-verbose-output/**,**/.trunk/**"',
      ],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
      },
    );

    const reportPath = join(jscpdOutputDir, "jscpd-report.json");
    if (existsSync(reportPath)) {
      const rawOutput = readFileSync(reportPath, "utf-8");
      const jsonOutput = JSON.parse(rawOutput);
      const findings = parseJscpdOutput(jsonOutput);
      return { tool: "jscpd", rawOutput, jsonOutput, findings };
    }

    return {
      tool: "jscpd",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: "No report generated",
    };
  } catch (error) {
    return {
      tool: "jscpd",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: String(error),
    };
  }
}

function runDepcruiseVerbose(rootPath: string): ToolResult {
  console.log("\n📋 Running dependency-cruiser...");

  const configPath = join(rootPath, ".dependency-cruiser.cjs");
  if (!existsSync(configPath)) {
    return {
      tool: "dependency-cruiser",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: "No config file",
    };
  }

  try {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "dependency-cruiser",
        "scripts",
        "test-fixtures",
        "--config",
        ".dependency-cruiser.cjs",
        "--output-type",
        "json",
      ],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    const rawOutput = result.stdout || "";
    if (rawOutput.trim().startsWith("{")) {
      const jsonOutput = JSON.parse(rawOutput);
      const findings = parseDepcruiseOutput(jsonOutput);
      return { tool: "dependency-cruiser", rawOutput, jsonOutput, findings };
    }

    return {
      tool: "dependency-cruiser",
      rawOutput,
      jsonOutput: null,
      findings: [],
      error: "No JSON output",
    };
  } catch (error) {
    return {
      tool: "dependency-cruiser",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: String(error),
    };
  }
}

function runKnipVerbose(rootPath: string): ToolResult {
  console.log("\n📋 Running knip...");

  const configPath = join(rootPath, "knip.json");
  if (!existsSync(configPath)) {
    return {
      tool: "knip",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: "No config file",
    };
  }

  try {
    const result = spawnSync("pnpm", ["exec", "knip", "--reporter", "json"], {
      cwd: rootPath,
      encoding: "utf-8",
      shell: true,
      maxBuffer: 50 * 1024 * 1024,
    });

    const rawOutput = result.stdout || "";
    if (rawOutput.trim().startsWith("{")) {
      const jsonOutput = JSON.parse(rawOutput);
      const findings = parseKnipOutput(jsonOutput);
      return { tool: "knip", rawOutput, jsonOutput, findings };
    }

    return {
      tool: "knip",
      rawOutput,
      jsonOutput: null,
      findings: [],
      error: "No JSON output",
    };
  } catch (error) {
    return {
      tool: "knip",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: String(error),
    };
  }
}

function runSemgrepVerbose(rootPath: string): ToolResult {
  console.log("\n📋 Running semgrep...");

  try {
    const versionCheck = spawnSync("semgrep", ["--version"], {
      encoding: "utf-8",
      shell: true,
    });

    if (versionCheck.status !== 0) {
      return {
        tool: "semgrep",
        rawOutput: "",
        jsonOutput: null,
        findings: [],
        error: "Not installed",
      };
    }

    const result = spawnSync(
      "semgrep",
      ["scan", "--json", "--config", "p/security-audit", "."],
      {
        cwd: rootPath,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 50 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      },
    );

    const rawOutput = result.stdout || "";
    const jsonMatch = rawOutput.match(/\{[\s\S]*"version"[\s\S]*\}(?=\s*$)/);

    if (jsonMatch) {
      const jsonOutput = JSON.parse(jsonMatch[0]);
      const findings = parseSemgrepOutput(jsonOutput);
      return { tool: "semgrep", rawOutput, jsonOutput, findings };
    }

    // Check for Windows encoding error
    if (result.stderr?.includes("charmap")) {
      return {
        tool: "semgrep",
        rawOutput: result.stderr,
        jsonOutput: null,
        findings: [],
        error: "Windows encoding issue",
      };
    }

    return {
      tool: "semgrep",
      rawOutput: rawOutput + (result.stderr || ""),
      jsonOutput: null,
      findings: [],
      error: "No JSON output",
    };
  } catch (error) {
    return {
      tool: "semgrep",
      rawOutput: "",
      jsonOutput: null,
      findings: [],
      error: String(error),
    };
  }
}

// ============================================================================
// GitHub Issue Preview Generator
// ============================================================================

interface GitHubIssuePreview {
  title: string;
  body: string;
  labels: string[];
  finding: Finding;
}

function generateIssuePreview(
  finding: Finding,
  runNumber: number = 1,
): GitHubIssuePreview {
  const location = finding.locations[0];
  const fileName = location?.path?.split(/[/\\]/).pop() || "unknown";

  // Build title without duplicating ruleId in title
  const title = `[vibeCop] ${finding.title} in ${fileName}`;

  const body = `## Summary

**Tool:** \`${finding.tool}\`
**Rule:** \`${finding.ruleId}\`
**Severity:** ${finding.severity}
**Confidence:** ${finding.confidence}
**Effort:** ${finding.effort}
**Layer:** ${finding.layer}

${finding.message}

## Location

\`${location?.path || "unknown"}\` (line ${location?.startLine || 1}${location?.endLine ? `-${location.endLine}` : ""})

${finding.locations.length > 1 ? `Plus ${finding.locations.length - 1} additional location(s)` : ""}

## Evidence

${finding.evidence ? "```\n" + (typeof finding.evidence === "string" ? finding.evidence : (finding.evidence as { snippet?: string }).snippet || JSON.stringify(finding.evidence, null, 2)) + "\n```" : "_No code evidence available_"}

## Agent Instructions

This issue is designed to be resolved by an AI coding agent (e.g., codex).

1. Create a branch: \`vibecop/${finding.fingerprint.substring(0, 12)}/${finding.ruleId.toLowerCase().replace(/[^a-z0-9]/g, "-")}\`
2. Implement the suggested fix
3. Run \`trunk check\` and \`pnpm test\` to verify
4. Open a PR referencing this issue: "Fixes #ISSUE_NUMBER"

## Metadata

- **Fingerprint:** \`${finding.fingerprint}\`
- **Commit:** \`${process.env.GITHUB_SHA || "unknown"}\`
- **Run:** #${runNumber}
- **Generated:** ${new Date().toISOString()}
`;

  return {
    title,
    body,
    labels: finding.labels || [
      "vibeCop",
      `tool:${finding.tool}`,
      `severity:${finding.severity}`,
    ],
    finding,
  };
}

function filterFindingsForIssues(
  findings: Finding[],
  severityThreshold: string = "info", // Default: include all severities
  confidenceThreshold: string = "low", // Default: include all confidences
): Finding[] {
  const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const confidenceOrder = { high: 2, medium: 1, low: 0 };

  const minSeverity =
    severityOrder[severityThreshold as keyof typeof severityOrder] || 0;
  const minConfidence =
    confidenceOrder[confidenceThreshold as keyof typeof confidenceOrder] || 0;

  return findings.filter((f) => {
    const severity =
      severityOrder[f.severity as keyof typeof severityOrder] || 0;
    const confidence =
      confidenceOrder[f.confidence as keyof typeof confidenceOrder] || 0;

    // Include if: (high severity regardless of confidence) OR (meets both thresholds)
    // This ensures high-severity security findings aren't filtered out due to low confidence
    if (severity >= severityOrder.high) {
      return true;
    }
    return severity >= minSeverity && confidence >= minConfidence;
  });
}

// ============================================================================
// Main Verbose Analysis
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const rootPath =
    args.find((a) => a.startsWith("--root="))?.split("=")[1] || process.cwd();
  const severityThreshold =
    args.find((a) => a.startsWith("--severity-threshold="))?.split("=")[1] ||
    "info";
  const confidenceThreshold =
    args.find((a) => a.startsWith("--confidence-threshold="))?.split("=")[1] ||
    "low";
  const mergeStrategy = (args
    .find((a) => a.startsWith("--merge-strategy="))
    ?.split("=")[1] || "same-rule") as MergeStrategy;
  const outputDir = join(rootPath, ".vibecop-verbose-output");

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log(
    "║          vibeCop Verbose Analysis Runner                    ║",
  );
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nRoot: ${rootPath}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Severity threshold: ${severityThreshold}`);
  console.log(`Confidence threshold: ${confidenceThreshold}`);
  console.log(`Merge strategy: ${mergeStrategy}`);

  // Create output directory
  mkdirSync(outputDir, { recursive: true });

  // Detect repo profile
  console.log("\n📊 Detecting repository profile...");
  const profile = await detectRepo(rootPath);
  writeFileSync(
    join(outputDir, "00-repo-profile.json"),
    JSON.stringify(profile, null, 2),
  );
  console.log(`   Languages: ${profile.languages.join(", ")}`);

  // Run all tools
  const toolResults: ToolResult[] = [];

  // 1. Trunk (handles ESLint, Prettier, and many other linters)
  const trunkResult = runTrunkVerbose(rootPath);
  toolResults.push(trunkResult);
  writeFileSync(join(outputDir, "01-trunk-raw.txt"), trunkResult.rawOutput);
  writeFileSync(
    join(outputDir, "01-trunk-parsed.json"),
    JSON.stringify(trunkResult.jsonOutput, null, 2),
  );
  writeFileSync(
    join(outputDir, "01-trunk-findings.json"),
    JSON.stringify(trunkResult.findings, null, 2),
  );
  console.log(
    `   ✓ Trunk: ${trunkResult.findings.length} findings ${trunkResult.error ? `(${trunkResult.error})` : ""}`,
  );

  // 2. TypeScript
  const tscResult = runTscVerbose(rootPath);
  toolResults.push(tscResult);
  writeFileSync(join(outputDir, "02-tsc-raw.txt"), tscResult.rawOutput);
  writeFileSync(
    join(outputDir, "02-tsc-parsed.json"),
    JSON.stringify(tscResult.jsonOutput, null, 2),
  );
  writeFileSync(
    join(outputDir, "02-tsc-findings.json"),
    JSON.stringify(tscResult.findings, null, 2),
  );
  console.log(
    `   ✓ TypeScript: ${tscResult.findings.length} findings ${tscResult.error ? `(${tscResult.error})` : ""}`,
  );

  // NOTE: ESLint is handled by Trunk, skipping to avoid duplicates
  console.log(`   ⏭ ESLint: skipped (handled by Trunk)`);

  // 3. jscpd
  const jscpdResult = runJscpdVerbose(rootPath, outputDir);
  toolResults.push(jscpdResult);
  writeFileSync(join(outputDir, "03-jscpd-raw.json"), jscpdResult.rawOutput);
  writeFileSync(
    join(outputDir, "03-jscpd-findings.json"),
    JSON.stringify(jscpdResult.findings, null, 2),
  );
  console.log(
    `   ✓ jscpd: ${jscpdResult.findings.length} findings ${jscpdResult.error ? `(${jscpdResult.error})` : ""}`,
  );

  // 4. dependency-cruiser
  const depcruiseResult = runDepcruiseVerbose(rootPath);
  toolResults.push(depcruiseResult);
  writeFileSync(
    join(outputDir, "04-depcruiser-raw.json"),
    depcruiseResult.rawOutput,
  );
  writeFileSync(
    join(outputDir, "04-depcruiser-findings.json"),
    JSON.stringify(depcruiseResult.findings, null, 2),
  );
  console.log(
    `   ✓ dependency-cruiser: ${depcruiseResult.findings.length} findings ${depcruiseResult.error ? `(${depcruiseResult.error})` : ""}`,
  );

  // 5. knip
  const knipResult = runKnipVerbose(rootPath);
  toolResults.push(knipResult);
  writeFileSync(join(outputDir, "05-knip-raw.json"), knipResult.rawOutput);
  writeFileSync(
    join(outputDir, "05-knip-findings.json"),
    JSON.stringify(knipResult.findings, null, 2),
  );
  console.log(
    `   ✓ knip: ${knipResult.findings.length} findings ${knipResult.error ? `(${knipResult.error})` : ""}`,
  );

  // 6. Semgrep
  const semgrepResult = runSemgrepVerbose(rootPath);
  toolResults.push(semgrepResult);
  writeFileSync(join(outputDir, "06-semgrep-raw.txt"), semgrepResult.rawOutput);
  writeFileSync(
    join(outputDir, "06-semgrep-parsed.json"),
    JSON.stringify(semgrepResult.jsonOutput, null, 2),
  );
  writeFileSync(
    join(outputDir, "06-semgrep-findings.json"),
    JSON.stringify(semgrepResult.findings, null, 2),
  );
  console.log(
    `   ✓ semgrep: ${semgrepResult.findings.length} findings ${semgrepResult.error ? `(${semgrepResult.error})` : ""}`,
  );

  // Combine all findings
  console.log("\n📊 Processing findings...");
  const allFindings = toolResults.flatMap((r) => r.findings);
  const uniqueFindings = deduplicateFindings(allFindings);

  writeFileSync(
    join(outputDir, "10-all-findings.json"),
    JSON.stringify(allFindings, null, 2),
  );
  writeFileSync(
    join(outputDir, "11-unique-findings.json"),
    JSON.stringify(uniqueFindings, null, 2),
  );

  console.log(`   Total findings: ${allFindings.length}`);
  console.log(`   Unique findings: ${uniqueFindings.length}`);

  // Generate issue previews
  console.log("\n📝 Generating GitHub issue previews...");

  // Filter by thresholds (uses CLI args, defaults to include all)
  const issueableFindings = filterFindingsForIssues(
    uniqueFindings,
    severityThreshold,
    confidenceThreshold,
  );
  console.log(
    `   Findings meeting threshold (severity>=${severityThreshold}, confidence>=${confidenceThreshold}): ${issueableFindings.length}`,
  );

  // Merge findings based on strategy
  const mergedFindings = mergeIssues(issueableFindings, mergeStrategy);
  console.log(
    `   After merging (strategy=${mergeStrategy}): ${mergedFindings.length} issues`,
  );

  // Write merged findings
  writeFileSync(
    join(outputDir, "12-merged-findings.json"),
    JSON.stringify(mergedFindings, null, 2),
  );

  const issuePreviews = mergedFindings.map((f, _i) =>
    generateIssuePreview(f, 1),
  );

  // Write issue previews
  writeFileSync(
    join(outputDir, "20-issue-previews.json"),
    JSON.stringify(issuePreviews, null, 2),
  );

  // Write individual issue files for easy viewing
  const issueDir = join(outputDir, "issues");
  mkdirSync(issueDir, { recursive: true });

  issuePreviews.forEach((issue, i) => {
    const num = String(i + 1).padStart(3, "0");
    const safeName = issue.finding.ruleId
      .replace(/[^a-zA-Z0-9]/g, "-")
      .substring(0, 30);

    // Markdown preview
    writeFileSync(
      join(issueDir, `${num}-${safeName}.md`),
      `# ${issue.title}\n\n**Labels:** ${issue.labels.join(", ")}\n\n---\n\n${issue.body}`,
    );

    // JSON for API
    writeFileSync(
      join(issueDir, `${num}-${safeName}.json`),
      JSON.stringify(
        {
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
          finding: {
            tool: issue.finding.tool,
            ruleId: issue.finding.ruleId,
            severity: issue.finding.severity,
            confidence: issue.finding.confidence,
            fingerprint: issue.finding.fingerprint,
            locations: issue.finding.locations,
          },
        },
        null,
        2,
      ),
    );
  });

  // Summary
  console.log(
    "\n╔════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║                        SUMMARY                              ║",
  );
  console.log("╚════════════════════════════════════════════════════════════╝");

  const byTool: Record<string, number> = {};
  uniqueFindings.forEach((f) => {
    byTool[f.tool] = (byTool[f.tool] || 0) + 1;
  });

  console.log("\nFindings by tool (before merging):");
  Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tool, count]) => {
      console.log(`   ${tool.padEnd(20)} ${count}`);
    });

  console.log(`\nIssue Reduction:`);
  console.log(`   Raw findings:     ${allFindings.length}`);
  console.log(`   After dedup:      ${uniqueFindings.length}`);
  console.log(`   After threshold:  ${issueableFindings.length}`);
  console.log(
    `   After merging:    ${mergedFindings.length} (${mergeStrategy})`,
  );
  console.log(`\nGitHub Issues that would be created: ${issuePreviews.length}`);

  const bySeverity: Record<string, number> = {};
  mergedFindings.forEach((f) => {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  });

  console.log("\nMerged issues by severity:");
  ["critical", "high", "medium", "low", "info"].forEach((sev) => {
    if (bySeverity[sev]) {
      console.log(`   ${sev.padEnd(10)} ${bySeverity[sev]}`);
    }
  });

  console.log("\n📁 Output files written to:", outputDir);
  console.log("\nKey files to review:");
  console.log("   - 01-trunk-findings.json      (Trunk linter results)");
  console.log("   - 02-tsc-findings.json        (TypeScript errors)");
  console.log("   - 03-jscpd-findings.json      (Duplicate code)");
  console.log("   - 04-depcruiser-findings.json (Architecture issues)");
  console.log("   - 05-knip-findings.json       (Unused exports)");
  console.log("   - 06-semgrep-findings.json    (Security issues)");
  console.log("   - 10-all-findings.json        (All findings before dedup)");
  console.log("   - 11-unique-findings.json     (All unique findings)");
  console.log(
    "   - 12-merged-findings.json     (After merge strategy applied)",
  );
  console.log("   - 20-issue-previews.json      (GitHub issues JSON)");
  console.log("   - issues/*.md                 (Individual issue previews)");
}

main().catch(console.error);
