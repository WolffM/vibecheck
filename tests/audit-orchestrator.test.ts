import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit/index.js";

const tempDir = mkdtempSync(join(tmpdir(), "vibecheck-audit-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

describe("runAudit (scaffold)", () => {
  it("resolves config and git anchor on this repo", async () => {
    const result = await runAudit({ rootPath: process.cwd() });
    expect(result.anchorSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.lanesPlanned).toEqual(["size", "arrival"]);
    expect(result.config.sizeTiers).toEqual([500, 1000, 2000]);
  });

  it("reports a null anchor outside a git repository", async () => {
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
