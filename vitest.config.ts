import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Ratchet, not aspiration: set just under the measured floor (90.9/98.9/96.9/96.9) so CI
      // fails on any coverage regression. What remains uncovered is deliberate: race-window and
      // fs-error defensive arms not reachable deterministically through the public API (e.g.
      // remove.ts prune races, lock.ts steal re-diagnosis arms) — raise further only with tests
      // that pin real behavior, never with coverage-farming.
      thresholds: { branches: 90, functions: 98, lines: 96, statements: 96 },
    },
    globalSetup: './vitest.global-setup.ts',
    projects: ['packages/*'],
  },
});
