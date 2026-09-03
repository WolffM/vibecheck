import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("analyze.ts entrypoint", () => {
  it("does not run CLI side effects when imported", () => {
    const output = execFileSync(
      "node",
      ["--import", "tsx", "-e", "import('./src/core/analyze.ts'); console.log('imported');"],
      {
        cwd: repoRoot,
        encoding: "utf-8",
      },
    );

    expect(output).toContain("imported");
    expect(output).not.toContain("=== vibeCheck ===");
  });

  it("still runs as a CLI when executed directly", () => {
    const output = execFileSync(
      "node",
      ["--import", "tsx", "src/core/analyze.ts", "--help"],
      {
        cwd: repoRoot,
        encoding: "utf-8",
      },
    );

    expect(output).toContain("Usage: analyze [options]");
  });
});
