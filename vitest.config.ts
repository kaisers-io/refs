import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Ratchet, not aspiration: set just under the measured floor (85.4/96.6/93.8/93.8) so CI
      // fails on any coverage regression. Raise as targeted tests close the remaining gaps
      // (context.ts production seam, lock/cleanup edge paths).
      thresholds: { branches: 85, functions: 95, lines: 93, statements: 93 },
    },
    globalSetup: './vitest.global-setup.ts',
    projects: ['packages/*'],
  },
});
