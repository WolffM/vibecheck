/**
 * Scoring Module
 *
 * Re-exports all scoring-related functions from submodules.
 *
 * Reference: vibeCheck_spec.md section 7
 */

// Hierarchy and thresholds
export {
  CONFIDENCE_ORDER,
  compareConfidence,
  compareFindingsForSort,
  compareSeverity,
  meetsConfidenceThreshold,
  meetsSeverityThreshold,
  meetsThresholds,
  SEVERITY_ORDER,
} from "./hierarchy.js";

// Tool-specific mappers
export {
  mapBanditConfidence,
  mapBanditSeverity,
  mapDepcruiseConfidence,
  mapDepcruiseSeverity,
  mapEslintConfidence,
  mapEslintSeverity,
  mapJscpdConfidence,
  mapJscpdSeverity,
  mapKnipConfidence,
  mapKnipSeverity,
  mapMypyConfidence,
  mapMypySeverity,
  mapPmdConfidence,
  mapPmdSeverity,
  mapRuffConfidence,
  mapRuffSeverity,
  mapSemgrepConfidence,
  mapSemgrepSeverity,
  mapSpotBugsConfidence,
  mapSpotBugsSeverity,
  mapTscConfidence,
  mapTscSeverity,
} from "./tool-mappers.js";

// Classification
export { classifyLayer } from "./classification.js";

// Autofix detection
export { determineAutofixLevel } from "./autofix.js";
