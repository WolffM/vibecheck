/**
 * Tool Output Parsers
 *
 * Re-exports all parser functions from categorized modules.
 * Parsers transform tool output into the unified Finding model.
 *
 * Reference: vibeCheck_spec.md sections 6, 7
 */

// TypeScript/JavaScript parsers
export {
  parseTscOutput,
  parseTscTextOutput,
  parseJscpdOutput,
  parseDepcruiseOutput,
  parseKnipOutput,
  parseTrunkOutput,
  type DepcruiseOutput,
  type KnipOutput,
  type TrunkOutput,
} from "./parsers/typescript.js";

// Python parsers
export {
  parseRuffOutput,
  parseMypyOutput,
  parseBanditOutput,
  type BanditOutput,
} from "./parsers/python.js";

// Java parsers
export {
  parsePmdOutput,
  parseSpotBugsOutput,
  type PmdOutput,
  type SpotBugsSarifOutput,
} from "./parsers/java.js";

// Security parsers (cross-language)
export { parseSemgrepOutput, type SemgrepOutput } from "./parsers/security.js";
