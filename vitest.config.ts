import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['packages/*/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Ratchet, not aspiration: the aggregate gate sits under the measured aggregate
      // (92.7 branches, 99.1 functions, 97.9 lines, 98.0 statements on macOS) so CI fails on a
      // coverage regression. What remains uncovered is deliberate: race-window and
      // fs-error defensive arms not reachable deterministically through the public API (e.g.
      // lock.ts steal re-diagnosis arms) — raise further only with tests that pin real behavior,
      // never with coverage-farming. Where such an arm guards destructive or locking code, pin it
      // with a one-path fs failure injected under a mock, as the remove-fs-failures suite does.
      // Gated everywhere but Windows: a justified platform skip there must never flake the
      // ratchet. Coverage is still collected on Windows, only nothing is enforced.
      ...(process.platform === 'win32'
        ? {}
        : {
            thresholds: {
              branches: 90,
              functions: 98,
              lines: 96,
              // Every file, on top of the aggregate: the aggregate alone let one file sit at 36%
              // branches unnoticed. Just under the lowest files measured (75.0 branches, 81.0
              // functions, 85.7 lines, 85.9 statements); a file that drops further fails by name.
              perFile: { branches: 74, functions: 80, lines: 85, statements: 85 },
              statements: 96,
            },
          }),
    },
    globalSetup: './vitest.global-setup.ts',
    projects: ['packages/*'],
  },
});
