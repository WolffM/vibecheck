import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit/index.js";

const tempDir = mkdtempSync(join(tmpdir(), "vibecheck-audit-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("runAudit (scaffold)", () => {
  // Runs the full six-lane audit (knip, jscpd, type-coverage) — slow.
  it("resolves config and git anchor on this repo", { timeout: 60_000 }, async () => {
    const result = await runAudit({
      rootPath: process.cwd(),
      stampLedger: false,
    });
    expect(result.anchorSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.lanesPlanned).toEqual([
      "size",
      "arrival",
      "deadcode",
      "duplication",
      "smells",
      "consistency",
    ]);
    expect(result.config.sizeTiers).toEqual([500, 1000, 2000]);
  });

  // Same full six-lane audit as above, just rooted outside a git repo — so it
  // needs the same budget. Without it this inherits vitest's 5s default and
  // fails on any runner slower than a dedicated hosted VM (observed on claw-1,
  // 2026-08-17: the file takes ~29s wall-clock on the fleet).
  it("reports a null anchor outside a git repository", { timeout: 60_000 }, async () => {
    const result = await runAudit({ rootPath: tempDir });
    expect(result.anchorSha).toBeNull();
    expect(result.dirty).toBe(false);
  });

  it("rejects a missing root path", async () => {
    await expect(
      runAudit({ rootPath: join(tempDir, "does-not-exist") }),
    ).rejects.toThrow(/does not exist/);
  });
});
