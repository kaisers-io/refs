import { DEAD_PID, makeHome, writeLockDir } from './helpers/lock-fixture.ts';
import { describe, expect, it } from 'vitest';
import type { Home } from './helpers/lock-fixture.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { withLock } from '../src/lock.ts';

// Waiter count for the stress-regression test below.
const STRESS_WAITER_COUNT = 12;
// Per-waiter critical-section hold time.
const STRESS_HOLD_MS = 10;
// The safety invariant under test: never more than a single concurrent lock holder.
const SINGLE_HOLDER = 1;

// Windows gets three times the allowance, and the reason is structural rather than "CI is slow".
// The steal pipeline treats a sharing violation on the tombstone rename — or on re-creating a
// directory Windows still holds delete-pending — as a lost race and retries, and every retry costs
// a full `RETRY_INTERVAL_MS`. With this many waiters all stealing and releasing, those retries
// compound: measured at ~1.2s on macOS against timeouts past 10s on Windows CI runners.
//
// This buys patience, not leniency. The property under test (`maxConcurrent === 1`) is untouched
// and a genuine hang still fails, only later. The two values move together on purpose — the
// acquire budget stays at half the test timeout, so a waiter that truly cannot acquire surfaces as
// a conflictError instead of an uninformative vitest timeout.
const WINDOWS_TIMEOUT_FACTOR = 3;
const POSIX_TIMEOUT_FACTOR = 1;
const TIMEOUT_FACTOR = process.platform === 'win32' ? WINDOWS_TIMEOUT_FACTOR : POSIX_TIMEOUT_FACTOR;
const BASE_ACQUIRE_TIMEOUT_MS = 5000;
const BASE_TEST_TIMEOUT_MS = 10_000;
const STRESS_ACQUIRE_TIMEOUT_MS = BASE_ACQUIRE_TIMEOUT_MS * TIMEOUT_FACTOR;
const STRESS_TEST_TIMEOUT_MS = BASE_TEST_TIMEOUT_MS * TIMEOUT_FACTOR;

type StressResult = {
  entered: number[];
  exited: number[];
  maxConcurrent: number;
};

// Runs `STRESS_WAITER_COUNT` concurrent `withLock` calls against whatever lock state `home`
// Already carries, recording how many ever held the critical section at once.
const runConcurrencyStress = async (home: Home): Promise<StressResult> => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const entered: number[] = [];
  const exited: number[] = [];

  const task = (index: number): Promise<void> =>
    withLock(
      home,
      'home',
      async () => {
        concurrent += SINGLE_HOLDER;
        entered.push(index);
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(STRESS_HOLD_MS);
        concurrent -= SINGLE_HOLDER;
        exited.push(index);
      },
      { timeoutMs: STRESS_ACQUIRE_TIMEOUT_MS },
    );

  await Promise.all(Array.from({ length: STRESS_WAITER_COUNT }, (_unused, index) => task(index)));
  return { entered, exited, maxConcurrent };
};

describe('withLock stress regression', () => {
  it(
    'many concurrent waiters against one pre-seeded stale lock never run the critical section concurrently',
    async () => {
      expect.hasAssertions();
      const home = makeHome();
      // Dead pid + fresh timestamp: only the dead-pid check makes this one stealable.
      writeLockDir(home.locksDir, 'home', {
        acquired_at: new Date().toISOString(),
        pid: DEAD_PID,
      });

      const { entered, exited, maxConcurrent } = await runConcurrencyStress(home);

      expect(entered).toHaveLength(STRESS_WAITER_COUNT);
      expect(exited).toHaveLength(STRESS_WAITER_COUNT);
      expect(maxConcurrent).toBe(SINGLE_HOLDER);
    },
    STRESS_TEST_TIMEOUT_MS,
  );
});
