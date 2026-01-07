/**
 * Autofix Detection
 *
 * Determines autofix level based on tool and rule characteristics.
 */

import type { AutofixLevel, ToolName } from "../core/types.js";

/** ESLint rules with safe autofixes */
const ESLINT_SAFE_AUTOFIX_RULES = [
  "semi",
  "quotes",
  "indent",
  "comma-dangle",
  "no-extra-semi",
  "no-trailing-spaces",
  "eol-last",
  "space-before-function-paren",
  "object-curly-spacing",
  "array-bracket-spacing",
  "prefer-const",
  "no-var",
];

/** Ruff rules with safe autofixes */
const RUFF_SAFE_AUTOFIX_PREFIXES = [
  "I", // isort (import sorting)
  "W", // pycodestyle warnings (whitespace)
  "E1", // indentation
  "E2", // whitespace
  "E3", // blank lines
  "E7", // statement (e.g., multiple statements)
  "Q", // quotes
  "COM", // commas
  "UP", // pyupgrade (safe modernizations)
];

/**
 * Determine autofix level based on tool and rule.
 */
export function determineAutofixLevel(
  tool: ToolName,
  ruleId: string,
  hasFixInfo: boolean,
): AutofixLevel {
  // Prettier always has safe autofix
  if (tool === "prettier") {
    return "safe";
  }

  // ESLint with fix info
  if (tool === "eslint" && hasFixInfo) {
    if (ESLINT_SAFE_AUTOFIX_RULES.some((r) => ruleId.includes(r))) {
      return "safe";
    }
    return "requires_review";
  }

  // Trunk may provide autofix
  if (tool === "trunk" && hasFixInfo) {
    return "requires_review";
  }

  // Ruff has autofix for many rules
  if (tool === "ruff" && hasFixInfo) {
    if (
      RUFF_SAFE_AUTOFIX_PREFIXES.some((prefix) => ruleId.startsWith(prefix))
    ) {
      return "safe";
    }
    return "requires_review";
  }

  return "none";
}
