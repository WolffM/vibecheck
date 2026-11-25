import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The JSON report is what CI's report-tests step posts to the fleet test
    // store; `default` keeps the console output.
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/vitest.json' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['tests/**/*.ts'],
    },
  },
});
