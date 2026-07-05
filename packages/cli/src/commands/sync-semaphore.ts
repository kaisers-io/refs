// Tiny inline concurrency semaphore for `sync-core.ts#syncAll` — caps how many refs sync at once
// without pulling in a dependency. `acquire` resolves immediately while under `limit`, otherwise
// queues the waiter (FIFO, via `Promise.withResolvers` rather than a `new Promise` executor);
// `release` frees the slot and wakes the next waiter, if any.

const SLOT_STEP = 1;

interface Semaphore {
  acquire: () => Promise<void>;
  release: () => void;
}

const createSemaphore = (limit: number): Semaphore => {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = (): void => {
    active -= SLOT_STEP;
    const wake = queue.shift();
    if (wake !== undefined) {
      wake();
    }
  };
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += SLOT_STEP;
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    queue.push(() => {
      active += SLOT_STEP;
      resolve();
    });
    return promise;
  };
  return { acquire, release };
};

/** Runs `fn` once a semaphore slot is free, always releasing it afterwards (success or throw). */
const runGated = async <TResult>(sem: Semaphore, fn: () => Promise<TResult>): Promise<TResult> => {
  await sem.acquire();
  try {
    return await fn();
  } finally {
    sem.release();
  }
};

export { createSemaphore, runGated };
export type { Semaphore };
