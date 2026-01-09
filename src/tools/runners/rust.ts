/**
 * Rust Tool Runners
 *
 * Runners for Rust analysis tools: Clippy, cargo-audit, cargo-deny
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Finding } from "../../core/types.js";
import { isToolAvailable, safeParseJson, findCargoDirectories } from "../tool-utils.js";
import {
  parseClippyOutput,
  parseCargoAuditOutput,
  parseCargoDenyOutput,
  type CargoAuditOutput,
  type CargoDenyOutput,
} from "../../parsers.js";
import { MAX_OUTPUT_BUFFER } from "../../utils/shared.js";

/** Directories to exclude for Rust (comma-separated) */
export const EXCLUDE_DIRS_RUST = "target,.cargo";

/**
 * Run Clippy linter for Rust code.
 * Searches for Cargo.toml in root and common subdirectories.
 */
export function runClippy(rootPath: string, _configPath?: string): Finding[] {
  console.log("Running clippy...");

  try {
    // Check if cargo is available
    const { available } = isToolAvailable("cargo", false);
    if (!available) {
      console.log("  Cargo not installed, skipping clippy");
      return [];
    }

    // Find directories containing Cargo.toml
    const cargoDirs = findCargoDirectories(rootPath);
    if (cargoDirs.length === 0) {
      console.log("  No Cargo.toml found, skipping clippy");
      return [];
    }

    const allFindings: Finding[] = [];

    for (const cargoDir of cargoDirs) {
      console.log(`  Running clippy in ${relative(rootPath, cargoDir) || "."}`);

      // Run clippy with JSON message format
      // Only enable default clippy::all lints, not pedantic (too noisy)
      const args = [
        "clippy",
        "--message-format=json",
        "--all-targets",
        "--",
        "-W",
        "clippy::all",
      ];

      const result = spawnSync("cargo", args, {
        cwd: cargoDir,
        encoding: "utf-8",
        shell: true,
        maxBuffer: MAX_OUTPUT_BUFFER,
      });

      // Clippy outputs JSON messages to stdout, one per line
      const output = result.stdout || "";
      const messages: unknown[] = [];

      for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          try {
            const parsed = JSON.parse(trimmed);
            // Only keep compiler_message type entries
            if (parsed.reason === "compiler-message" && parsed.message) {
              messages.push(parsed.message);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      if (messages.length > 0) {
        const findings = parseClippyOutput(messages);
        // Adjust file paths to be relative to rootPath
        for (const finding of findings) {
          if (cargoDir !== rootPath) {
            const relDir = relative(rootPath, cargoDir);
            for (const loc of finding.locations) {
              if (loc.path && !loc.path.startsWith(relDir)) {
                loc.path = `${relDir}/${loc.path}`;
              }
            }
          }
        }
        allFindings.push(...findings);
      }
    }

    return allFindings;
  } catch (error) {
    console.warn("clippy failed:", error);
  }

  return [];
}

/**
 * Run cargo-audit to check for security vulnerabilities in dependencies.
 * Searches for Cargo.toml in root and common subdirectories.
 */
export function runCargoAudit(rootPath: string): Finding[] {
  console.log("Running cargo-audit...");

  try {
    // Check if cargo-audit is available
    const { available } = isToolAvailable("cargo-audit", false);
    if (!available) {
      console.log("  cargo-audit not installed, skipping");
      return [];
    }

    // Find directories containing Cargo.toml
    const cargoDirs = findCargoDirectories(rootPath);
    if (cargoDirs.length === 0) {
      console.log("  No Cargo.toml found, skipping cargo-audit");
      return [];
    }

    const allFindings: Finding[] = [];

    for (const cargoDir of cargoDirs) {
      console.log(`  Running cargo-audit in ${relative(rootPath, cargoDir) || "."}`);

      const args = ["audit", "--json"];

      const result = spawnSync("cargo", args, {
        cwd: cargoDir,
        encoding: "utf-8",
        shell: true,
        maxBuffer: MAX_OUTPUT_BUFFER,
      });

      // cargo-audit outputs JSON to stdout
      const output = result.stdout || "";
      const parsed = safeParseJson<CargoAuditOutput>(output);
      if (parsed) {
        const findings = parseCargoAuditOutput(parsed);
        // Adjust file paths to be relative to rootPath
        for (const finding of findings) {
          if (cargoDir !== rootPath) {
            const relDir = relative(rootPath, cargoDir);
            for (const loc of finding.locations) {
              if (loc.path && !loc.path.startsWith(relDir)) {
                loc.path = `${relDir}/${loc.path}`;
              }
            }
          }
        }
        allFindings.push(...findings);
      }
    }

    return allFindings;
  } catch (error) {
    console.warn("cargo-audit failed:", error);
  }

  return [];
}

/**
 * Run cargo-deny to check dependencies for licenses, bans, advisories, and sources.
 * Searches for Cargo.toml in root and common subdirectories.
 */
export function runCargoDeny(rootPath: string, configPath?: string): Finding[] {
  console.log("Running cargo-deny...");

  try {
    // Check if cargo-deny is available
    const { available } = isToolAvailable("cargo-deny", false);
    if (!available) {
      console.log("  cargo-deny not installed, skipping");
      return [];
    }

    // Find directories containing Cargo.toml
    const cargoDirs = findCargoDirectories(rootPath);
    if (cargoDirs.length === 0) {
      console.log("  No Cargo.toml found, skipping cargo-deny");
      return [];
    }

    const allFindings: Finding[] = [];

    for (const cargoDir of cargoDirs) {
      console.log(`  Running cargo-deny in ${relative(rootPath, cargoDir) || "."}`);

      // --format is a global flag that comes before the subcommand
      const args = ["deny", "--format", "json"];

      // Look for deny.toml in the cargo directory first, then use provided configPath
      const localConfig = join(cargoDir, "deny.toml");
      if (existsSync(localConfig)) {
        console.log(`    Using config: ${localConfig}`);
        args.push("--config", localConfig);
      } else if (configPath) {
        console.log(`    Using config: ${configPath}`);
        args.push("--config", configPath);
      } else {
        console.log("    No deny.toml config found");
      }

      // Add the check subcommand after the global flags
      args.push("check");

      const result = spawnSync("cargo", args, {
        cwd: cargoDir,
        encoding: "utf-8",
        shell: true,
        maxBuffer: MAX_OUTPUT_BUFFER,
      });

      // cargo-deny outputs JSON to both stdout and stderr depending on version
      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      const combinedOutput = stdout + "\n" + stderr;
      const diagnostics: unknown[] = [];

      // Debug output
      if (result.status !== 0) {
        console.log(`    Exit code: ${result.status}`);
      }
      if (stderr && !stderr.includes("{")) {
        console.log(`    Stderr: ${stderr.slice(0, 200)}`);
      }

      for (const line of combinedOutput.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          try {
            diagnostics.push(JSON.parse(trimmed));
          } catch {
            // Skip malformed lines
          }
        }
      }

      console.log(`    Found ${diagnostics.length} JSON diagnostics`);

      if (diagnostics.length > 0) {
        const findings = parseCargoDenyOutput({ diagnostics } as CargoDenyOutput);
        // Adjust file paths to be relative to rootPath
        for (const finding of findings) {
          if (cargoDir !== rootPath) {
            const relDir = relative(rootPath, cargoDir);
            for (const loc of finding.locations) {
              if (loc.path && !loc.path.startsWith(relDir)) {
                loc.path = `${relDir}/${loc.path}`;
              }
            }
          }
        }
        allFindings.push(...findings);
      }
    }

    return allFindings;
  } catch (error) {
    console.warn("cargo-deny failed:", error);
  }

  return [];
}
