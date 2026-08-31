// Shared by both packages' vitest configs.
//
// `testTimeout` raises vitest's 5s default to 15s for EVERY test. Measured across the suite the
// median test takes 1ms and the 95th percentile 7s, so this is an enormous margin for the 99% while
// still surfacing a hang in seconds. It is three times the default, not twelve — the tests that
// genuinely need longer ask for it individually, from `test/helpers/timeouts.ts`, rather than the
// whole suite giving up its hang detection for their sake.
const TEST_TIMEOUT_MS = 15_000;

export const sharedTestConfig = {
  environment: 'node',
  testTimeout: TEST_TIMEOUT_MS,
  typecheck: { enabled: true },
} as const;
