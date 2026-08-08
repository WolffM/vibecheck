import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { publishLocal } from "../src/audit/publish/local.js";
import { renderAuditReport } from "../src/audit/report.js";
import { fixtureResult } from "./helpers/audit-fixture.js";

const cleanups: string[] = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});


describe("renderAuditReport", () => {
  it("matches the golden report byte for byte", () => {
    const golden = readFileSync(
      join(__dirname, "golden", "audit-report.golden.md"),
      "utf-8",
    );
    expect(renderAuditReport(fixtureResult())).toBe(golden);
  });

  it("is deterministic across repeated renders", () => {
    expect(renderAuditReport(fixtureResult())).toBe(
      renderAuditReport(fixtureResult()),
    );
  });

  it("never leaks unrounded scores into the body", () => {
    const body = renderAuditReport(fixtureResult()).replace(
      /## Appendix[\s\S]*/,
      "",
    );
    // Quantized floors (0.75) and tool versions (3.7.0) are fine; raw
    // weighted scores (4.593, 0.976) are not.
    expect(body).not.toMatch(/\d\.\d{3,}/);
  });
});

describe("publishLocal", () => {
  it("writes audit.md and out/audit.json under .vibecheck", () => {
    const root = mkdtempSync(join(tmpdir(), "vibecheck-publish-"));
    cleanups.push(root);
    const { reportPath, machinePath } = publishLocal(fixtureResult(root));
    expect(reportPath).toBe(join(root, ".vibecompact", "audit.md"));
    expect(readFileSync(reportPath, "utf-8")).toContain("# vibeCompact");
    const machine = JSON.parse(readFileSync(machinePath, "utf-8"));
    expect(machine.worstOffenders).toEqual(["src/dumped.ts", "src/app.ts"]);
    expect(machine.anchorSha).toMatch(/^0123/);
  });
});
