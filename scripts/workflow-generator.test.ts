/**
 * Workflow Generator Tests
 *
 * Tests for the install page's workflow YAML generation.
 * Verifies that UI options are properly fed into the generated workflow file.
 */

import { describe, it, expect } from 'vitest';
import {
  getCronForCadence,
  generateWorkflow,
  DEFAULTS,
  DEFAULT_TOOLS,
  type WorkflowOptions,
} from './workflow-generator.js';

/** Create test options with defaults and optional overrides */
function createTestOptions(overrides: Partial<WorkflowOptions> = {}): WorkflowOptions {
  return {
    ...DEFAULTS,
    disabledTools: [],
    ...overrides,
  };
}

describe('getCronForCadence', () => {
  it('should return daily cron expression', () => {
    expect(getCronForCadence('daily')).toBe('0 3 * * *');
  });

  it('should return weekly cron expression', () => {
    expect(getCronForCadence('weekly')).toBe('0 3 * * 1');
  });

  it('should return monthly cron expression', () => {
    expect(getCronForCadence('monthly')).toBe('0 3 1 * *');
  });
});

describe('generateWorkflow', () => {
  describe('default options', () => {
    it('should generate valid YAML with default options', () => {
      const options = createTestOptions();
      const yaml = generateWorkflow(options);

      // Check basic structure
      expect(yaml).toContain('name: vibeCheck Analysis');
      expect(yaml).toContain('uses: WolffM/vibecheck@main');
      expect(yaml).toContain('cron: "0 3 * * 1"'); // weekly
    });

    it('should include severity_threshold for default low (not info)', () => {
      const options = createTestOptions(); // default severity is 'low'
      const yaml = generateWorkflow(options);

      // 'low' severity should be included (only 'info' is omitted)
      expect(yaml).toContain('severity_threshold: "low"');
    });

    it('should include confidence_threshold for default medium (not low)', () => {
      const options = createTestOptions(); // default confidence is 'medium'
      const yaml = generateWorkflow(options);

      // 'medium' confidence should be included (only 'low' is omitted)
      expect(yaml).toContain('confidence_threshold: "medium"');
    });

    it('should not include merge_strategy when using default', () => {
      const options = createTestOptions();
      const yaml = generateWorkflow(options);

      // Default merge strategy is 'same-linter', should not appear
      expect(yaml).not.toContain('merge_strategy:');
    });
  });

  describe('cadence options', () => {
    it('should use daily cron and comment', () => {
      const options = createTestOptions({ cadence: 'daily' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('cron: "0 3 * * *"');
      expect(yaml).toContain('# Run daily at 3am UTC');
    });

    it('should use weekly cron and comment', () => {
      const options = createTestOptions({ cadence: 'weekly' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('cron: "0 3 * * 1"');
      expect(yaml).toContain('# Run weekly on Monday at 3am UTC');
    });

    it('should use monthly cron and comment', () => {
      const options = createTestOptions({ cadence: 'monthly' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('cron: "0 3 1 * *"');
      expect(yaml).toContain('# Run monthly on the 1st at 3am UTC');
    });
  });

  describe('severity options', () => {
    it('should omit severity_threshold only for info level', () => {
      const options = createTestOptions({ severity: 'info' });
      const yaml = generateWorkflow(options);

      // 'info' is the baseline - no threshold needed
      expect(yaml).not.toContain('severity_threshold:');
    });

    it('should include severity_threshold for low', () => {
      const options = createTestOptions({ severity: 'low' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('severity_threshold: "low"');
    });

    it('should include severity_threshold for medium', () => {
      const options = createTestOptions({ severity: 'medium' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('severity_threshold: "medium"');
    });

    it('should include severity_threshold for high', () => {
      const options = createTestOptions({ severity: 'high' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('severity_threshold: "high"');
    });

    it('should include severity_threshold for critical', () => {
      const options = createTestOptions({ severity: 'critical' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('severity_threshold: "critical"');
    });
  });

  describe('confidence options', () => {
    it('should omit confidence_threshold for low level', () => {
      const options = createTestOptions({ confidence: 'low' });
      const yaml = generateWorkflow(options);

      expect(yaml).not.toContain('confidence_threshold:');
    });

    it('should include confidence_threshold for medium', () => {
      const options = createTestOptions({ confidence: 'medium' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('confidence_threshold: "medium"');
    });

    it('should include confidence_threshold for high', () => {
      const options = createTestOptions({ confidence: 'high' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('confidence_threshold: "high"');
    });
  });

  describe('merge strategy options', () => {
    it('should omit merge_strategy for same-linter (default)', () => {
      const options = createTestOptions({ mergeStrategy: 'same-linter' });
      const yaml = generateWorkflow(options);

      expect(yaml).not.toContain('merge_strategy:');
    });

    it('should include merge_strategy for none', () => {
      const options = createTestOptions({ mergeStrategy: 'none' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('merge_strategy: "none"');
    });

    it('should include merge_strategy for same-file', () => {
      const options = createTestOptions({ mergeStrategy: 'same-file' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('merge_strategy: "same-file"');
    });

    it('should include merge_strategy for same-tool', () => {
      const options = createTestOptions({ mergeStrategy: 'same-tool' });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('merge_strategy: "same-tool"');
    });
  });

  describe('disabled tools', () => {
    it('should not add comments when no tools disabled', () => {
      const options = createTestOptions({ disabledTools: [] });
      const yaml = generateWorkflow(options);

      expect(yaml).not.toContain('# Note: Some tools disabled');
    });

    it('should add comments for disabled tools', () => {
      const options = createTestOptions({ disabledTools: ['trunk', 'semgrep'] });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('# Note: Some tools disabled');
      expect(yaml).toContain('#   trunk: { enabled: false }');
      expect(yaml).toContain('#   semgrep: { enabled: false }');
    });

    it('should convert dependency-cruiser to dependency_cruiser in config', () => {
      const options = createTestOptions({ disabledTools: ['dependency-cruiser'] });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('#   dependency_cruiser: { enabled: false }');
      expect(yaml).not.toContain('#   dependency-cruiser:');
    });
  });

  describe('combined options', () => {
    it('should handle all custom options together', () => {
      const options = createTestOptions({
        cadence: 'daily',
        severity: 'high',
        confidence: 'high',
        mergeStrategy: 'same-file',
        disabledTools: ['jscpd', 'knip'],
      });
      const yaml = generateWorkflow(options);

      expect(yaml).toContain('cron: "0 3 * * *"');
      expect(yaml).toContain('severity_threshold: "high"');
      expect(yaml).toContain('confidence_threshold: "high"');
      expect(yaml).toContain('merge_strategy: "same-file"');
      expect(yaml).toContain('#   jscpd: { enabled: false }');
      expect(yaml).toContain('#   knip: { enabled: false }');
    });
  });
});

describe('DEFAULTS', () => {
  it('should have expected default values', () => {
    expect(DEFAULTS.cadence).toBe('weekly');
    expect(DEFAULTS.severity).toBe('low');
    expect(DEFAULTS.confidence).toBe('medium');
    expect(DEFAULTS.maxIssues).toBe(25);
    expect(DEFAULTS.mergeStrategy).toBe('same-linter');
  });
});

describe('DEFAULT_TOOLS', () => {
  it('should include all expected tools', () => {
    expect(DEFAULT_TOOLS).toContain('trunk');
    expect(DEFAULT_TOOLS).toContain('semgrep');
    expect(DEFAULT_TOOLS).toContain('jscpd');
    expect(DEFAULT_TOOLS).toContain('tsc');
    expect(DEFAULT_TOOLS).toContain('dependency-cruiser');
    expect(DEFAULT_TOOLS).toContain('knip');
    expect(DEFAULT_TOOLS).toContain('ruff');
    expect(DEFAULT_TOOLS).toContain('mypy');
    expect(DEFAULT_TOOLS).toContain('bandit');
    expect(DEFAULT_TOOLS).toContain('pmd');
    expect(DEFAULT_TOOLS).toContain('spotbugs');
  });

  it('should have expected count', () => {
    expect(DEFAULT_TOOLS).toHaveLength(11);
  });
});
