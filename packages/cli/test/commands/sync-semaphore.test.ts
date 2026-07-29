import { createSemaphore, runGated } from '../../src/commands/sync-semaphore.ts';
import { describe, expect, it } from 'vitest';
import { setImmediate as settle } from 'node:timers/promises';

// The inline semaphore is what keeps `refs sync` from launching every ref's git pipeline at once —
// these tests pin the scheduling contract `sync-core.ts#syncAll` relies on: the cap is enforced,
// waiters wake strictly in submission (fifo) order, and a slot is freed even when the gated task
// throws (a stuck slot would silently serialize — or deadlock — every later ref in the batch).

type GatedTask = {
  finish: () => void;
  promise: Promise<void>;
};

// Starts a `runGated` task that records `start:<name>`/`end:<name>` around an externally
// controlled gate, so tests can advance the schedule one task at a time.
const startGated = (
  sem: ReturnType<typeof createSemaphore>,
  order: string[],
  name: string,
): GatedTask => {
  const { promise: gate, resolve: finish } = Promise.withResolvers<void>();
  const promise = runGated(sem, async () => {
    order.push(`start:${name}`);
    await gate;
    order.push(`end:${name}`);
  });
  return { finish, promise };
};

const finishAndSnapshot = async (task: GatedTask, order: string[]): Promise<string[]> => {
  task.finish();
  await settle();
  return [...order];
};

// Runs three gated tasks through a limit-1 semaphore, snapshotting the observed order after each
// task is allowed to finish — the returned snapshots prove both the cap (never two `start`s
// without an `end` between them) and fifo waking (b before c).
const runFifoScenario = async (): Promise<string[][]> => {
  const sem = createSemaphore(1);
  const order: string[] = [];
  const tasks = ['a', 'b', 'c'].map((name) => startGated(sem, order, name));
  await settle();
  const snapshots = [[...order]];
  for (const task of tasks) {
    // eslint-disable-next-line no-await-in-loop -- the schedule is advanced one task at a time by design
    snapshots.push(await finishAndSnapshot(task, order));
  }
  await Promise.all(tasks.map((task) => task.promise));
  return snapshots;
};

describe('sync semaphore', () => {
  it('runs gated tasks strictly sequentially and wakes waiters in submission order', async () => {
    expect.hasAssertions();
    const snapshots = await runFifoScenario();
    expect(snapshots).toStrictEqual([
      ['start:a'],
      ['start:a', 'end:a', 'start:b'],
      ['start:a', 'end:a', 'start:b', 'end:b', 'start:c'],
      ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'],
    ]);
  });

  it('frees the slot when a gated task throws, so the next waiter still runs', async () => {
    expect.hasAssertions();
    const sem = createSemaphore(1);
    const order: string[] = [];
    const failing = runGated(sem, () => Promise.reject(new Error('boom')));
    const next = runGated(sem, () => {
      order.push('ran');
      return Promise.resolve();
    });
    await expect(failing).rejects.toThrow('boom');
    await next;
    expect(order).toStrictEqual(['ran']);
  });
});
