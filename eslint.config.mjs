// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".trunk/**",
      "*.lock",
      "pnpm-lock.yaml",
    ],
  },
  // CommonJS files (.cjs) - allow module/require globals
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  // CLI bin files - Node.js globals and allow console
  {
    files: ["bin/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  // Scripts - allow console.log (it's a CLI tool)
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  // Main source files
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
    rules: {
      "no-var": "error",
      "prefer-const": "warn",
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow control characters in regex (used for ANSI code stripping)
      "no-control-regex": "off",
    },
  },
  // Test fixtures - keep no-console warning to demonstrate ESLint
  {
    files: ["test-fixtures/**/*.ts"],
    rules: {
      "no-console": "warn",
      // Relax some rules for intentionally bad test code
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
);
