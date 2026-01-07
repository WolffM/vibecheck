/**
 * Repo Detection Module
 *
 * Inspects the target repository to build a RepoProfile used for
 * automatic tool enablement decisions.
 *
 * Reference: vibeCheck_spec.md section 5.3
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Language, PackageManager, RepoProfile } from "./types.js";

/**
 * Check if any files with a given extension exist in common directories.
 */
function hasFilesWithExtension(
  rootPath: string,
  extension: string,
  dirs: string[],
): boolean {
  for (const dir of dirs) {
    const dirPath = join(rootPath, dir);
    if (existsSync(dirPath)) {
      try {
        const files = readdirSync(dirPath);
        if (files.some((f) => f.endsWith(extension))) {
          return true;
        }
      } catch {
        // ignore
      }
    }
  }
  return false;
}

/**
 * Detect the package manager based on lockfile presence
 */
function detectPackageManager(rootPath: string): PackageManager {
  if (existsSync(join(rootPath, "pnpm-lock.yaml"))) return "pnpm";
  if (
    existsSync(join(rootPath, "bun.lockb")) ||
    existsSync(join(rootPath, "bun.lock"))
  )
    return "bun";
  if (existsSync(join(rootPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(rootPath, "package-lock.json"))) return "npm";
  if (existsSync(join(rootPath, "package.json"))) return "npm"; // default if package.json exists
  return "unknown";
}

/**
 * Detect programming languages present in the repo
 */
async function detectLanguages(rootPath: string): Promise<Language[]> {
  const languages: Language[] = [];

  // TypeScript detection
  const hasTsConfig =
    existsSync(join(rootPath, "tsconfig.json")) ||
    existsSync(join(rootPath, "tsconfig.base.json"));

  // Check package.json for typescript dependency
  let hasTypescriptDep = false;
  const packageJsonPath = join(rootPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      hasTypescriptDep =
        pkg.devDependencies?.typescript ||
        pkg.dependencies?.typescript ||
        false;
    } catch {
      // ignore parse errors
    }
  }

  if (hasTsConfig || hasTypescriptDep) {
    languages.push("typescript");
  }

  // JavaScript detection (if package.json exists but no TypeScript)
  if (existsSync(packageJsonPath) && !languages.includes("typescript")) {
    languages.push("javascript");
  }

  // Python detection - check for project files or .py files in key directories
  const hasPythonProject =
    existsSync(join(rootPath, "pyproject.toml")) ||
    existsSync(join(rootPath, "setup.py")) ||
    existsSync(join(rootPath, "requirements.txt")) ||
    existsSync(join(rootPath, "Pipfile"));

  // Also check for .py files in common directories (including test-fixtures for demo)
  const hasPythonFiles = hasFilesWithExtension(rootPath, ".py", [
    "src",
    "lib",
    "app",
    "scripts",
    "test-fixtures",
    ".",
  ]);

  if (hasPythonProject || hasPythonFiles) {
    languages.push("python");
  }

  // Go detection
  if (
    existsSync(join(rootPath, "go.mod")) ||
    existsSync(join(rootPath, "go.sum"))
  ) {
    languages.push("go");
  }

  // Rust detection
  if (existsSync(join(rootPath, "Cargo.toml"))) {
    languages.push("rust");
  }

  // Java detection - check for project files or .java files in key directories
  const hasJavaProject =
    existsSync(join(rootPath, "pom.xml")) ||
    existsSync(join(rootPath, "build.gradle")) ||
    existsSync(join(rootPath, "build.gradle.kts"));

  // Also check for .java files in common directories (including test-fixtures for demo)
  const hasJavaFiles = hasFilesWithExtension(rootPath, ".java", [
    "src",
    "lib",
    "app",
    "test-fixtures",
    ".",
  ]);

  if (hasJavaProject || hasJavaFiles) {
    languages.push("java");
  }

  return languages.length > 0 ? languages : ["other"];
}

/**
 * Detect if the repo is a monorepo and find workspace packages
 */
async function detectMonorepo(rootPath: string): Promise<{
  isMonorepo: boolean;
  workspacePackages: string[];
}> {
  const workspacePackages: string[] = [];

  // Check for pnpm workspace
  if (existsSync(join(rootPath, "pnpm-workspace.yaml"))) {
    // Parse pnpm-workspace.yaml for package patterns
    try {
      const content = readFileSync(
        join(rootPath, "pnpm-workspace.yaml"),
        "utf-8",
      );
      // Simple pattern extraction (packages: - 'apps/*' - 'packages/*')
      const matches = content.match(/['"]([^'"]+)['"]/g);
      if (matches) {
        for (const match of matches) {
          const pattern = match.replace(/['"]/g, "").replace("/*", "");
          const fullPath = join(rootPath, pattern);
          if (existsSync(fullPath)) {
            try {
              const dirs = await readdir(fullPath, { withFileTypes: true });
              for (const dir of dirs) {
                if (dir.isDirectory()) {
                  workspacePackages.push(join(pattern, dir.name));
                }
              }
            } catch {
              // directory doesn't exist or can't be read
            }
          }
        }
      }
    } catch {
      // ignore parse errors
    }
    return { isMonorepo: true, workspacePackages };
  }

  // Check for npm/yarn workspaces in package.json
  const packageJsonPath = join(rootPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      if (pkg.workspaces) {
        const patterns = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : pkg.workspaces.packages || [];

        for (const pattern of patterns) {
          const basePattern = pattern.replace("/*", "").replace("/**", "");
          const fullPath = join(rootPath, basePattern);
          if (existsSync(fullPath)) {
            try {
              const dirs = await readdir(fullPath, { withFileTypes: true });
              for (const dir of dirs) {
                if (dir.isDirectory()) {
                  workspacePackages.push(join(basePattern, dir.name));
                }
              }
            } catch {
              // directory doesn't exist or can't be read
            }
          }
        }

        if (patterns.length > 0) {
          return { isMonorepo: true, workspacePackages };
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // Check for Turborepo
  if (existsSync(join(rootPath, "turbo.json"))) {
    // turbo.json usually implies monorepo
    return { isMonorepo: true, workspacePackages };
  }

  // Check for Lerna
  if (existsSync(join(rootPath, "lerna.json"))) {
    return { isMonorepo: true, workspacePackages };
  }

  // Check for Nx
  if (existsSync(join(rootPath, "nx.json"))) {
    // Check for apps/ and libs/ directories
    for (const dir of ["apps", "libs", "packages"]) {
      const fullPath = join(rootPath, dir);
      if (existsSync(fullPath)) {
        try {
          const dirs = await readdir(fullPath, { withFileTypes: true });
          for (const d of dirs) {
            if (d.isDirectory()) {
              workspacePackages.push(join(dir, d.name));
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return { isMonorepo: true, workspacePackages };
  }

  return { isMonorepo: false, workspacePackages: [] };
}

/**
 * Check for presence of various tool configurations
 */
function detectToolConfigs(rootPath: string): {
  hasEslint: boolean;
  hasPrettier: boolean;
  hasTrunk: boolean;
  hasDependencyCruiser: boolean;
  hasKnip: boolean;
  // Python tools
  hasRuff: boolean;
  hasMypy: boolean;
  // Java tools
  hasPmd: boolean;
  hasSpotBugs: boolean;
} {
  // ESLint configs (multiple possible names)
  const eslintConfigs = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.mjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
  ];
  const hasEslint = eslintConfigs.some((config) =>
    existsSync(join(rootPath, config)),
  );

  // Prettier configs
  const prettierConfigs = [
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.toml",
    "prettier.config.js",
    "prettier.config.mjs",
    "prettier.config.cjs",
  ];
  const hasPrettier = prettierConfigs.some((config) =>
    existsSync(join(rootPath, config)),
  );

  // Trunk
  const hasTrunk = existsSync(join(rootPath, ".trunk", "trunk.yaml"));

  // dependency-cruiser
  const depCruiserConfigs = [
    ".dependency-cruiser.js",
    ".dependency-cruiser.cjs",
    ".dependency-cruiser.mjs",
    ".dependency-cruiser.json",
  ];
  const hasDependencyCruiser = depCruiserConfigs.some((config) =>
    existsSync(join(rootPath, config)),
  );

  // Knip
  const knipConfigs = [
    "knip.json",
    "knip.jsonc",
    ".knip.json",
    ".knip.jsonc",
    "knip.ts",
    "knip.js",
  ];
  const hasKnip = knipConfigs.some((config) =>
    existsSync(join(rootPath, config)),
  );

  // Ruff (Python linter)
  const ruffConfigs = ["ruff.toml", ".ruff.toml"];
  // Also check pyproject.toml for [tool.ruff] section
  let hasRuffInPyproject = false;
  const pyprojectPath = join(rootPath, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, "utf-8");
      hasRuffInPyproject = content.includes("[tool.ruff]");
    } catch {
      // ignore
    }
  }
  const hasRuff =
    ruffConfigs.some((config) => existsSync(join(rootPath, config))) ||
    hasRuffInPyproject;

  // Mypy (Python type checker)
  const mypyConfigs = ["mypy.ini", ".mypy.ini"];
  // Also check pyproject.toml for [tool.mypy] and setup.cfg for [mypy]
  let hasMypyInPyproject = false;
  let hasMypyInSetupCfg = false;
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, "utf-8");
      hasMypyInPyproject = content.includes("[tool.mypy]");
    } catch {
      // ignore
    }
  }
  const setupCfgPath = join(rootPath, "setup.cfg");
  if (existsSync(setupCfgPath)) {
    try {
      const content = readFileSync(setupCfgPath, "utf-8");
      hasMypyInSetupCfg = content.includes("[mypy]");
    } catch {
      // ignore
    }
  }
  const hasMypy =
    mypyConfigs.some((config) => existsSync(join(rootPath, config))) ||
    hasMypyInPyproject ||
    hasMypyInSetupCfg;

  // PMD (Java static analysis)
  const pmdConfigs = ["pmd-ruleset.xml", "ruleset.xml", "pmd.xml", ".pmd"];
  const hasPmd = pmdConfigs.some((config) =>
    existsSync(join(rootPath, config)),
  );

  // SpotBugs (Java bytecode analyzer)
  const spotbugsConfigs = [
    "spotbugs-exclude.xml",
    "spotbugs-include.xml",
    "spotbugs.xml",
    "findbugs-exclude.xml", // Legacy name
  ];
  const hasSpotBugs = spotbugsConfigs.some((config) =>
    existsSync(join(rootPath, config)),
  );

  return {
    hasEslint,
    hasPrettier,
    hasTrunk,
    hasDependencyCruiser,
    hasKnip,
    hasRuff,
    hasMypy,
    hasPmd,
    hasSpotBugs,
  };
}

/**
 * Main detection function - builds complete RepoProfile
 */
export async function detectRepo(
  rootPath: string = process.cwd(),
): Promise<RepoProfile> {
  const resolvedPath = resolve(rootPath);

  const languages = await detectLanguages(resolvedPath);
  const packageManager = detectPackageManager(resolvedPath);
  const { isMonorepo, workspacePackages } = await detectMonorepo(resolvedPath);
  const toolConfigs = detectToolConfigs(resolvedPath);

  return {
    languages,
    packageManager,
    isMonorepo,
    workspacePackages,
    hasTypeScript: languages.includes("typescript"),
    hasEslint: toolConfigs.hasEslint,
    hasPrettier: toolConfigs.hasPrettier,
    hasTrunk: toolConfigs.hasTrunk,
    hasDependencyCruiser: toolConfigs.hasDependencyCruiser,
    hasKnip: toolConfigs.hasKnip,
    rootPath: resolvedPath,
    // Python/Java detection
    hasPython: languages.includes("python"),
    hasJava: languages.includes("java"),
    hasRuff: toolConfigs.hasRuff,
    hasMypy: toolConfigs.hasMypy,
    hasPmd: toolConfigs.hasPmd,
    hasSpotBugs: toolConfigs.hasSpotBugs,
  };
}

/**
 * CLI entry point
 */
async function main() {
  const rootPath = process.argv[2] || process.cwd();
  const profile = await detectRepo(rootPath);
  console.log(JSON.stringify(profile, null, 2));
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
