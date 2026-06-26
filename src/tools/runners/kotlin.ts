/**
 * Kotlin Tool Runners
 *
 * Runners for Kotlin analysis tools: detekt
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../../core/types.js";
import { safeParseJson } from "../tool-utils.js";
import { parseDetektOutput, type DetektSarifOutput } from "../../parsers/index.js";
import { MAX_OUTPUT_BUFFER } from "../../utils/shared.js";

/**
 * Run detekt static analyzer for Kotlin code.
 * Requires Java 17+ and detekt CLI installed.
 */
export function runDetekt(rootPath: string, configPath?: string): Finding[] {
  console.log("Running detekt...");

  try {
    // Check if Kotlin files exist
    const hasKotlin = existsSync(join(rootPath, "build.gradle.kts")) ||
      existsSync(join(rootPath, "composeApp", "build.gradle.kts")) ||
      existsSync(join(rootPath, "settings.gradle.kts"));
    if (!hasKotlin) {
      console.log("  No Kotlin project detected, skipping");
      return [];
    }

    // Check if detekt is available (via gradle plugin or CLI)
    // Try gradle plugin first: ./gradlew detekt
    const gradleCheck = spawnSync("./gradlew", ["detekt", "--dry-run"], {
      cwd: rootPath,
      encoding: "utf-8",
      timeout: 30000,
    });

    let detektOutput = "";
    let sarifPath = "";

    if (gradleCheck.status === 0 || gradleCheck.stdout?.includes("detekt")) {
      // detekt gradle plugin available — run it with SARIF output
      console.log("  Running detekt via Gradle plugin...");
      const outputDir = join(rootPath, "build", "reports", "detekt");
      sarifPath = join(outputDir, "detekt.sarif");

      const args = ["detekt"];
      if (configPath) {
        args.push("-Pplugin=detekt");
      }

      const result = spawnSync("./gradlew", args, {
        cwd: rootPath,
        encoding: "utf-8",
        timeout: 300000, // 5 min timeout for gradle build
        maxBuffer: MAX_OUTPUT_BUFFER,
      });

      // detekt writes SARIF to build/reports/detekt/detekt.sarif
      if (!existsSync(sarifPath)) {
        // Try alternate path
        sarifPath = join(rootPath, "composeApp", "build", "reports", "detekt", "detekt.sarif");
      }
    } else {
      // Try detekt CLI — check PATH and known install locations
      const detektVersion = "1.23.7";
      const knownPaths = [
        "detekt", // on PATH
        "detekt-cli", // detekt CLI installed by vibeCheck action (binary is named detekt-cli)
        `/tmp/detekt/detekt-cli-${detektVersion}/bin/detekt-cli`,
        `/tmp/detekt/detekt-cli-${detektVersion}/bin/detekt-cli.bat`,
      ];

      let detektCmd: string | null = null;
      for (const cmd of knownPaths) {
        const check = spawnSync(cmd, ["--version"], {
          encoding: "utf-8",
          timeout: 10000,
        });
        if (check.status === 0) {
          detektCmd = cmd;
          break;
        }
      }

      if (!detektCmd) {
        console.log("  detekt CLI not found, skipping");
        return [];
      }

      console.log(`  Running detekt CLI (${detektCmd})...`);
      sarifPath = join(rootPath, ".detekt-output.sarif");
      const args = [
        "--input", rootPath,
        "--report", `sarif:${sarifPath}`,
      ];
      if (configPath) {
        args.push("--config", configPath);
      }

      const cliResult = spawnSync(detektCmd, args, {
        cwd: rootPath,
        encoding: "utf-8",
        timeout: 120000,
        maxBuffer: MAX_OUTPUT_BUFFER,
      });
      // detekt exit codes: 0 = clean, 1 = error, 2 = violations found (normal)
      // Treat exit code 2 as success — findings are in the SARIF report
      if (cliResult.status === 1) {
        console.log(`  detekt CLI error: ${(cliResult.stderr || "").trim().slice(0, 200)}`);
      }
    }

    // Parse SARIF output
    if (existsSync(sarifPath)) {
      const sarifContent = readFileSync(sarifPath, "utf-8");
      const parsed = safeParseJson<DetektSarifOutput>(sarifContent);
      if (parsed) {
        const findings = parseDetektOutput(parsed, rootPath);
        console.log(`  detekt: ${findings.length} findings`);
        return findings;
      }
    } else {
      console.log("  detekt SARIF output not found, skipping");
    }
  } catch (error) {
    console.warn("detekt failed:", error);
  }

  return [];
}
