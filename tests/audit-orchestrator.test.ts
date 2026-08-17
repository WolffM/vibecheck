import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit/index.js";

const tempDir = mkdtempSync(join(tmpdir(), "vibecheck-audit-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

// EVERY test here calls runAudit, which runs the full six-lane audit (knip,
// jscpd, type-coverage) as subprocesses. The budget lives on the describe so a
// test added later inherits it: the per-test form was already missed once, and
// the null-anchor case sat on vitest's 5s default until it began failing
// deterministically on the self-hosted fleet (claw-1, 2026-08-17) while passing
// on a dedicated hosted VM. Cold cost of the cheapest case is ~1s on a claw;
// under a saturated runner, alongside the full-repo audit above, it exceeds 5s.
describe("runAudit (scaffold)", { timeout: 60_000 }, () => {
  it("resolves config and git anchor on this repo", async () => {
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
