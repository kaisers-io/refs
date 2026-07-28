import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { branches: 90, functions: 95, lines: 95, statements: 95 },
    },
    globalSetup: './vitest.global-setup.ts',
    projects: ['packages/*'],
  },
});
