import { describe, expect, it } from 'vitest';
import type { RenewOutcome } from '../src/lock-heartbeat.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { startHeartbeat } from '../src/lock-heartbeat.ts';

// The heartbeat takes its interval and its renewal function by injection, so every property below
// is pinned directly at millisecond scale — no timing seam on the public `withLock`, and no test
// that has to wait out a real 30-second heartbeat.

const TICK_MS = 5;
const POLL_MS = 2;
const WAIT_LIMIT_MS = 2000;
const SLOW_RENEW_MS = 60;
const SETTLE_MS = 50;
const EXPECTED_TICKS = 3;
const TWO_TICKS = 2;

// Staged renewal outcomes for the transient-failure suite. Defined at module scope so the mock
// swaps a reference instead of branching — `vitest/no-conditional-in-test` rightly rejects a test
// whose behaviour depends on an `if`.
const succeedOnce = (): Promise<RenewOutcome> => Promise.resolve('renewed');
const failOnce = (): Promise<RenewOutcome> => Promise.reject(new Error('EAGAIN'));

/** Polls until `predicate` holds, instead of sleeping a fixed span and hoping. Wall-clock waits are
 * what make timing tests flaky on a loaded machine; this only bounds the total. */
const waitUntil = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the heartbeat condition');
    }
    // eslint-disable-next-line no-await-in-loop -- polling is inherently sequential
    await delay(POLL_MS);
  }
};

describe('startHeartbeat renewal loop', () => {
  it('keeps renewing for as long as it is running', async () => {
    expect.hasAssertions();
    let calls = 0;
    const heartbeat = startHeartbeat({
      intervalMs: TICK_MS,
      renew: () => {
        calls += 1;
        return Promise.resolve<RenewOutcome>('renewed');
      },
    });

    await waitUntil(() => calls >= EXPECTED_TICKS);
    await heartbeat.stop();

    expect(heartbeat.ownershipLost()).toBe(false);
  });
});

describe('startHeartbeat single flight', () => {
  it('never overlaps two renewals, even when one outlives the interval', async () => {
    expect.hasAssertions();
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    // A renewal an order of magnitude slower than the interval is exactly the case a plain
    // `setInterval` would pile up — and overlapping renewals can stamp the lease out of order.
    const heartbeat = startHeartbeat({
      intervalMs: TICK_MS,
      renew: async () => {
        inFlight += 1;
        calls += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(SLOW_RENEW_MS);
        inFlight -= 1;
        return 'renewed';
      },
    });

    await waitUntil(() => calls >= TWO_TICKS);
    await heartbeat.stop();

    expect(maxInFlight).toBe(1);
  });
});

describe('startHeartbeat transient failures', () => {
  it('retries after a transient failure instead of giving up or rejecting', async () => {
    expect.hasAssertions();
    let calls = 0;
    // A thrown error is a transient fs failure, never an ownership answer — there is still lease
    // margin, so the loop must survive it and try again.
    let nextOutcome = failOnce;
    const heartbeat = startHeartbeat({
      intervalMs: TICK_MS,
      renew: () => {
        calls += 1;
        const outcome = nextOutcome;
        nextOutcome = succeedOnce;
        return outcome();
      },
    });

    await waitUntil(() => calls >= EXPECTED_TICKS);
    await heartbeat.stop();

    expect(heartbeat.ownershipLost()).toBe(false);
  });
});

describe('startHeartbeat ownership loss', () => {
  it('stops for good and records the loss once a renewal reports it', async () => {
    expect.hasAssertions();
    let calls = 0;
    const heartbeat = startHeartbeat({
      intervalMs: TICK_MS,
      renew: () => {
        calls += 1;
        return Promise.resolve<RenewOutcome>('lost');
      },
    });

    await waitUntil(() => heartbeat.ownershipLost());
    // Confirmed loss is terminal: there is nothing left to renew, and continuing would keep
    // stamping a lock that belongs to someone else.
    await delay(SETTLE_MS);

    expect(calls).toBe(1);
    await heartbeat.stop();
  });
});

describe('startHeartbeat shutdown', () => {
  it('waits for an in-flight renewal before resolving', async () => {
    expect.hasAssertions();
    let renewFinished = false;
    let started = false;
    const heartbeat = startHeartbeat({
      intervalMs: TICK_MS,
      renew: async () => {
        started = true;
        await delay(SLOW_RENEW_MS);
        renewFinished = true;
        return 'renewed';
      },
    });

    await waitUntil(() => started);
    // This is the race the awaited stop exists for: without it, `withLock` would release the lock
    // directory while a renewal was still running against it, and a successor could have recreated
    // that directory by the time the renewal landed.
    await heartbeat.stop();

    expect(renewFinished).toBe(true);
  });
});

describe('startHeartbeat shutdown finality', () => {
  it('starts no further renewal after stop resolves', async () => {
    expect.hasAssertions();
    let calls = 0;
    const heartbeat = startHeartbeat({
      intervalMs: TICK_MS,
      renew: () => {
        calls += 1;
        return Promise.resolve<RenewOutcome>('renewed');
      },
    });

    await waitUntil(() => calls >= 1);
    await heartbeat.stop();
    const callsAtStop = calls;
    await delay(SETTLE_MS);

    expect(calls).toBe(callsAtStop);
  });

  it('is idempotent, so a second stop neither throws nor waits', async () => {
    expect.hasAssertions();
    const heartbeat = startHeartbeat({
      intervalMs: TICK_MS,
      renew: () => Promise.resolve<RenewOutcome>('renewed'),
    });

    await heartbeat.stop();

    await expect(heartbeat.stop()).resolves.toBeUndefined();
  });
});
