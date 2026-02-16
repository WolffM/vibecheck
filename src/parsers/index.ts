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
  parseEslintOutput,
  type DepcruiseOutput,
  type KnipOutput,
  type TrunkOutput,
  type EslintOutput,
} from "./typescript.js";

// Python parsers
export {
  parseRuffOutput,
  parseMypyOutput,
  parseBanditOutput,
  parseVultureOutput,
  type BanditOutput,
} from "./python.js";

// Java parsers
export {
  parsePmdOutput,
  parseSpotBugsOutput,
  type PmdOutput,
  type SpotBugsSarifOutput,
} from "./java.js";

// Security parsers (cross-language)
export { parseSemgrepOutput, type SemgrepOutput } from "./security.js";

// Rust parsers
export {
  parseClippyOutput,
  parseCargoAuditOutput,
  parseCargoDenyOutput,
  type CargoAuditOutput,
  type CargoDenyOutput,
} from "./rust.js";
