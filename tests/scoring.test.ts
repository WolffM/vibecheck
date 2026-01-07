/**
 * Scoring Module Tests
 */

import { describe, it, expect } from 'vitest';
import {
  SEVERITY_ORDER,
  CONFIDENCE_ORDER,
  compareSeverity,
  compareConfidence,
  meetsSeverityThreshold,
  meetsConfidenceThreshold,
  mapEslintSeverity,
  mapEslintConfidence,
  mapTscSeverity,
  mapTscConfidence,
  mapJscpdSeverity,
  mapJscpdConfidence,
  mapDepcruiseSeverity,
  mapDepcruiseConfidence,
  mapKnipSeverity,
  mapKnipConfidence,
  mapSemgrepSeverity,
  mapSemgrepConfidence,
  classifyLayer,
  determineAutofixLevel,
  meetsThresholds,
  compareFindingsForSort,
} from '../src/scoring.js';

describe('severity ordering', () => {
  it('should have correct order', () => {
    expect(SEVERITY_ORDER.low).toBeLessThan(SEVERITY_ORDER.medium);
    expect(SEVERITY_ORDER.medium).toBeLessThan(SEVERITY_ORDER.high);
    expect(SEVERITY_ORDER.high).toBeLessThan(SEVERITY_ORDER.critical);
  });

  it('should compare severities correctly', () => {
    expect(compareSeverity('low', 'high')).toBeLessThan(0);
    expect(compareSeverity('high', 'low')).toBeGreaterThan(0);
    expect(compareSeverity('medium', 'medium')).toBe(0);
  });

  it('should check severity threshold', () => {
    expect(meetsSeverityThreshold('high', 'medium')).toBe(true);
    expect(meetsSeverityThreshold('medium', 'medium')).toBe(true);
    expect(meetsSeverityThreshold('low', 'medium')).toBe(false);
  });
});

describe('confidence ordering', () => {
  it('should have correct order', () => {
    expect(CONFIDENCE_ORDER.low).toBeLessThan(CONFIDENCE_ORDER.medium);
    expect(CONFIDENCE_ORDER.medium).toBeLessThan(CONFIDENCE_ORDER.high);
  });

  it('should compare confidence correctly', () => {
    expect(compareConfidence('low', 'high')).toBeLessThan(0);
    expect(compareConfidence('high', 'low')).toBeGreaterThan(0);
  });

  it('should check confidence threshold', () => {
    expect(meetsConfidenceThreshold('high', 'medium')).toBe(true);
    expect(meetsConfidenceThreshold('low', 'medium')).toBe(false);
  });
});

describe('ESLint mapping', () => {
  it('should map ESLint severity', () => {
    expect(mapEslintSeverity(2)).toBe('high');
    expect(mapEslintSeverity(1)).toBe('medium');
    expect(mapEslintSeverity(0)).toBe('low');
  });

  it('should map ESLint confidence by rule', () => {
    expect(mapEslintConfidence('no-undef')).toBe('high');
    expect(mapEslintConfidence('no-unused-vars')).toBe('high');
    expect(mapEslintConfidence('eqeqeq')).toBe('medium');
    expect(mapEslintConfidence('some-style-rule')).toBe('low');
  });
});

describe('TypeScript mapping', () => {
  it('should always return high severity', () => {
    expect(mapTscSeverity(2304)).toBe('high');
    expect(mapTscSeverity(2322)).toBe('high');
  });

  it('should always return high confidence', () => {
    expect(mapTscConfidence(2304)).toBe('high');
    expect(mapTscConfidence(2322)).toBe('high');
  });
});

describe('jscpd mapping', () => {
  it('should map severity by size', () => {
    expect(mapJscpdSeverity(50, 500)).toBe('high');
    expect(mapJscpdSeverity(30, 300)).toBe('medium');
    expect(mapJscpdSeverity(10, 100)).toBe('low');
  });

  it('should always return high confidence', () => {
    expect(mapJscpdConfidence(100)).toBe('high');
  });
});

describe('dependency-cruiser mapping', () => {
  it('should map severity by violation type', () => {
    expect(mapDepcruiseSeverity('not-allowed')).toBe('high');
    expect(mapDepcruiseSeverity('forbidden')).toBe('high');
    expect(mapDepcruiseSeverity('cycle')).toBe('high');
    expect(mapDepcruiseSeverity('orphan')).toBe('medium');
  });

  it('should map confidence by violation type', () => {
    expect(mapDepcruiseConfidence('cycle')).toBe('high');
    expect(mapDepcruiseConfidence('orphan')).toBe('medium');
  });
});

describe('knip mapping', () => {
  it('should map severity by issue type', () => {
    expect(mapKnipSeverity('dependencies')).toBe('high');
    expect(mapKnipSeverity('exports')).toBe('medium');
    expect(mapKnipSeverity('files')).toBe('medium');
  });

  it('should map confidence by issue type', () => {
    expect(mapKnipConfidence('dependencies')).toBe('high');
    expect(mapKnipConfidence('exports')).toBe('medium');
    expect(mapKnipConfidence('files')).toBe('high');
  });
});

describe('semgrep mapping', () => {
  it('should map severity from semgrep levels', () => {
    expect(mapSemgrepSeverity('error')).toBe('high');
    expect(mapSemgrepSeverity('high')).toBe('high');
    expect(mapSemgrepSeverity('warning')).toBe('medium');
    expect(mapSemgrepSeverity('info')).toBe('low');
  });

  it('should map confidence', () => {
    expect(mapSemgrepConfidence('high')).toBe('high');
    expect(mapSemgrepConfidence('medium')).toBe('medium');
    expect(mapSemgrepConfidence(undefined)).toBe('medium');
  });
});

describe('classifyLayer', () => {
  it('should classify security rules', () => {
    expect(classifyLayer('eslint', 'no-eval')).toBe('security');
    expect(classifyLayer('semgrep', 'injection-rule')).toBe('security');
  });

  it('should classify architecture tools', () => {
    expect(classifyLayer('dependency-cruiser', 'some-rule')).toBe('architecture');
    expect(classifyLayer('knip', 'unused-dep')).toBe('architecture');
  });

  it('should default to code layer', () => {
    expect(classifyLayer('eslint', 'no-unused-vars')).toBe('code');
    expect(classifyLayer('tsc', 'TS2304')).toBe('code');
  });
});

describe('determineAutofixLevel', () => {
  it('should return safe for prettier', () => {
    expect(determineAutofixLevel('prettier', 'any-rule', false)).toBe('safe');
  });

  it('should return safe for safe ESLint rules', () => {
    expect(determineAutofixLevel('eslint', 'semi', true)).toBe('safe');
    expect(determineAutofixLevel('eslint', 'quotes', true)).toBe('safe');
  });

  it('should return requires_review for other ESLint fixes', () => {
    expect(determineAutofixLevel('eslint', 'complex-rule', true)).toBe('requires_review');
  });

  it('should return none when no fix available', () => {
    expect(determineAutofixLevel('eslint', 'no-undef', false)).toBe('none');
  });
});

describe('meetsThresholds', () => {
  it('should return true when both thresholds met', () => {
    expect(meetsThresholds('high', 'high', 'medium', 'medium')).toBe(true);
    expect(meetsThresholds('medium', 'medium', 'medium', 'medium')).toBe(true);
  });

  it('should return false when severity below threshold', () => {
    expect(meetsThresholds('low', 'high', 'medium', 'medium')).toBe(false);
  });

  it('should return false when confidence below threshold', () => {
    expect(meetsThresholds('high', 'low', 'medium', 'medium')).toBe(false);
  });
});

describe('compareFindingsForSort', () => {
  it('should sort by severity descending', () => {
    const a = { severity: 'high' as const, confidence: 'high' as const, locations: [{ path: 'a.ts', startLine: 1 }] };
    const b = { severity: 'low' as const, confidence: 'high' as const, locations: [{ path: 'a.ts', startLine: 1 }] };

    expect(compareFindingsForSort(a, b)).toBeLessThan(0);
    expect(compareFindingsForSort(b, a)).toBeGreaterThan(0);
  });

  it('should sort by confidence descending when severity equal', () => {
    const a = { severity: 'high' as const, confidence: 'high' as const, locations: [{ path: 'a.ts', startLine: 1 }] };
    const b = { severity: 'high' as const, confidence: 'low' as const, locations: [{ path: 'a.ts', startLine: 1 }] };

    expect(compareFindingsForSort(a, b)).toBeLessThan(0);
  });

  it('should sort by path ascending when severity and confidence equal', () => {
    const a = { severity: 'high' as const, confidence: 'high' as const, locations: [{ path: 'a.ts', startLine: 1 }] };
    const b = { severity: 'high' as const, confidence: 'high' as const, locations: [{ path: 'b.ts', startLine: 1 }] };

    expect(compareFindingsForSort(a, b)).toBeLessThan(0);
  });

  it('should sort by line ascending when all else equal', () => {
    const a = { severity: 'high' as const, confidence: 'high' as const, locations: [{ path: 'a.ts', startLine: 10 }] };
    const b = { severity: 'high' as const, confidence: 'high' as const, locations: [{ path: 'a.ts', startLine: 20 }] };

    expect(compareFindingsForSort(a, b)).toBeLessThan(0);
  });
});
