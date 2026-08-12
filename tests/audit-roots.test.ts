import { describe, expect, it } from "vitest";
import { discoverJsRoots } from "../src/audit/roots.js";

describe("discoverJsRoots", () => {
  it("keeps the repo root when it has a manifest", () => {
    expect(
      discoverJsRoots(["package.json", "frontend/package.json", "src/a.ts"]),
    ).toEqual(["."]);
  });

  it("finds subproject roots when the repo root has none", () => {
    expect(
      discoverJsRoots([
        "pyproject.toml",
        "frontend/package.json",
        "frontend/src/App.tsx",
      ]),
    ).toEqual(["frontend"]);
  });

  it("prunes workspace members under a discovered root", () => {
    expect(
      discoverJsRoots([
        "apps/web/package.json",
        "apps/web/packages/ui/package.json",
      ]),
    ).toEqual(["apps/web"]);
  });

  it("keeps sibling projects separate", () => {
    expect(
      discoverJsRoots([
        "frontend/package.json",
        "tools/site/package.json",
      ]).sort(),
    ).toEqual(["frontend", "tools/site"]);
  });

  it("does not treat a name prefix as an ancestor", () => {
    expect(
      discoverJsRoots(["app/package.json", "apps/package.json"]).sort(),
    ).toEqual(["app", "apps"]);
  });

  it("honors configured roots verbatim", () => {
    expect(discoverJsRoots(["frontend/package.json"], ["custom"])).toEqual([
      "custom",
    ]);
  });

  it("returns nothing for a repo with no manifests", () => {
    expect(discoverJsRoots(["pyproject.toml", "api/server.py"])).toEqual([]);
  });
});
