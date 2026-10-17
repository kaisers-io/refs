// Tiny inline concurrency semaphore for `sync-core.ts#syncAll` — caps how many refs sync at once
// without pulling in a dependency — and, through `mapGated`, for `doctor`'s per-checkout git
// probes. `acquire` resolves immediately while under `limit`, otherwise
// queues the waiter (FIFO, via `Promise.withResolvers` rather than a `new Promise` executor);
// `release` frees the slot and wakes the next waiter, if any.

type Semaphore = {
  acquire: () => Promise<void>;
  release: () => void;
};

const createSemaphore = (limit: number): Semaphore => {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = (): void => {
    active -= 1;
    const wake = queue.shift();
    if (wake !== undefined) {
      wake();
    }
  };
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    queue.push(() => {
      active += 1;
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

/** `Promise.all(items.map(fn))` with at most `limit` calls of `fn` in flight. Results keep the
 * order of `items`, and a rejection rejects the batch exactly as `Promise.all` would — the only
 * thing that changes is how many calls run at once. */
const mapGated = <TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  fn: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> => {
  const sem = createSemaphore(limit);
  return Promise.all(items.map((item) => runGated(sem, () => fn(item))));
};

export { createSemaphore, mapGated, runGated };
