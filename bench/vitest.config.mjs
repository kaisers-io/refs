import { defineConfig } from 'vitest/config';

// Standalone config for the throwaway bench/pilot harness (not wired into the
// root workspace `projects`, so `pnpm check` stays scoped to shipped packages).
// Run with: pnpm exec vitest run --config bench/vitest.config.mjs
export default defineConfig({
  test: {
    environment: 'node',
    include: ['bench/test/**/*.test.mjs'],
  },
});
