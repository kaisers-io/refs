import { describe, expect, it } from 'vitest';
import type { PeakRunner } from './helpers/peak-runner.ts';
import { createPeakRunner } from './helpers/peak-runner.ts';
import { mapGated } from '../src/commands/sync-semaphore.ts';
import { setTimeout as sleep } from 'node:timers/promises';

// The fan-out tests trust `createPeakRunner` to report a capped fan-out as exactly its cap and an
// unbounded one as wider. These cases pin that against the shapes timing could otherwise fake: an
// allowed caller that starts late, and one more caller than the cap.

const CAP = 4;
const ROUNDS = 2;
const TOTAL = CAP * ROUNDS;
// Longer than any quiet period a timing-based release would wait for before answering.
const LATE_START_MS = 250;
// Inside the window the runner keeps a full barrier shut for, so a caller past the cap that is
// already on its way is still counted. Timers fire in expiry order, so this one always comes first.
const EXTRA_START_MS = 20;
const NO_LATE_ITEM = -1;
const ITEMS = Array.from({ length: TOTAL }, (_unused, index) => index);

type Probe = (item: number) => Promise<unknown>;

/** One git call per item, the call for `lateItem` only after `delayMs`. */
const probeWithLateStart =
  (runner: PeakRunner, lateItem: number, delayMs: number): Probe =>
  async (item) => {
    await sleep(item === lateItem ? delayMs : 0);
    return runner.run('git', ['status'], { cwd: String(item) });
  };

const newRunner = (): PeakRunner =>
  createPeakRunner({ respond: () => ({}), total: TOTAL, width: CAP });

describe('peak runner barrier', () => {
  it('shows a capped fan-out at its cap even when one allowed caller starts late', async () => {
    expect.hasAssertions();
    const runner = newRunner();
    await mapGated(ITEMS, CAP, probeWithLateStart(runner, 0, LATE_START_MS));
    expect(runner.calls()).toBe(TOTAL);
    expect(runner.peak()).toBe(CAP);
  });

  it('shows a fan-out one wider than expected as wider, even when the extra caller is late', async () => {
    expect.hasAssertions();
    const runner = newRunner();
    await mapGated(ITEMS, CAP + 1, probeWithLateStart(runner, CAP, EXTRA_START_MS));
    expect(runner.peak()).toBe(CAP + 1);
  });

  it('fails explicitly when fewer callers than expected can start', async () => {
    expect.hasAssertions();
    const runner = newRunner();
    await mapGated(ITEMS, CAP - 1, probeWithLateStart(runner, NO_LATE_ITEM, 0));
    expect(() => runner.peak()).toThrow(
      `PeakRunner barrier stalled: only ${CAP - 1} of ${CAP} expected callers arrived`,
    );
  });
});
