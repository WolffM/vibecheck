/**
 * Autofix Registry
 *
 * Registry of autofix commands for tools that support automatic code fixing.
 * Supports built-in commands and user-defined overrides via vibecheck.yml.
 */

import type { ToolName } from "../core/types.js";

// ============================================================================
// Types
// ============================================================================

export interface AutofixCommand {
  /** Command to run (e.g., "eslint", "ruff") */
  command: string;
  /** Arguments before file paths (e.g., ["--fix"], ["check", "--fix"]) */
  args: string[];
  /** Use npx to run command (default: false) */
  useNpx?: boolean;
  /** Description for PR title/body */
  description: string;
}

export interface AutofixConfig {
  [tool: string]: Partial<AutofixCommand> | false;
}

// ============================================================================
// Built-in Autofix Commands
// ============================================================================

/**
 * Built-in autofix commands for common tools.
 * These can be overridden via vibecheck.yml autofix config.
 */
export const BUILTIN_AUTOFIX: Partial<Record<ToolName | string, AutofixCommand>> = {
  // JavaScript/TypeScript
  eslint: {
    command: "eslint",
    args: ["--fix"],
    useNpx: true,
    description: "ESLint formatting",
  },
  prettier: {
    command: "prettier",
    args: ["--write"],
    useNpx: true,
    description: "Prettier formatting",
  },

  // Python
  ruff: {
    command: "ruff",
    args: ["check", "--fix"],
    useNpx: false,
    description: "Ruff style",
  },

  // Markdown
  markdownlint: {
    command: "markdownlint",
    args: ["--fix"],
    useNpx: true,
    description: "Markdown formatting",
  },

  // Trunk (meta-linter formatting)
  trunk: {
    command: "trunk",
    args: ["fmt"],
    useNpx: false,
    description: "Trunk formatting",
  },
};

// ============================================================================
// Registry Functions
// ============================================================================

/**
 * Get the autofix command for a tool.
 * Checks user config first (for overrides), then falls back to built-in.
 *
 * @param tool - Tool name
 * @param userConfig - Optional user autofix config from vibecheck.yml
 * @returns AutofixCommand or null if no autofix available
 */
export function getAutofixCommand(
  tool: string,
  userConfig?: AutofixConfig,
): AutofixCommand | null {
  // Check if user explicitly disabled this tool's autofix
  if (userConfig?.[tool] === false) {
    return null;
  }

  // Check for user override
  const userOverride = userConfig?.[tool];
  if (userOverride && typeof userOverride === "object") {
    // Merge with built-in defaults if available
    const builtin = BUILTIN_AUTOFIX[tool];
    if (builtin) {
      return {
        ...builtin,
        ...userOverride,
      } as AutofixCommand;
    }
    // User-defined tool (must have all required fields)
    if (userOverride.command && userOverride.args) {
      return {
        command: userOverride.command,
        args: userOverride.args,
        useNpx: userOverride.useNpx ?? false,
        description: userOverride.description ?? `${tool} fixes`,
      };
    }
    return null;
  }

  // Fall back to built-in
  return BUILTIN_AUTOFIX[tool] ?? null;
}

/**
 * Get all tools that have autofix commands available.
 *
 * @param userConfig - Optional user autofix config
 * @returns Array of tool names with autofix support
 */
export function getAutofixTools(userConfig?: AutofixConfig): string[] {
  const tools = new Set<string>();

  // Add built-in tools
  for (const tool of Object.keys(BUILTIN_AUTOFIX)) {
    tools.add(tool);
  }

  // Add user-defined tools
  if (userConfig) {
    for (const [tool, config] of Object.entries(userConfig)) {
      if (config !== false && typeof config === "object" && config.command) {
        tools.add(tool);
      }
    }
  }

  // Remove disabled tools
  if (userConfig) {
    for (const [tool, config] of Object.entries(userConfig)) {
      if (config === false) {
        tools.delete(tool);
      }
    }
  }

  return Array.from(tools);
}

/**
 * Check if a tool has autofix support.
 */
export function hasAutofixSupport(
  tool: string,
  userConfig?: AutofixConfig,
): boolean {
  return getAutofixCommand(tool, userConfig) !== null;
}
