import type { Spinner } from '../spinner.ts';

// What `refs sync` tells a person at a terminal while it works: how many refs are done. No ref is
// named: up to four sync at once, so any single name would suggest the others are not running.

type SyncTracker = {
  finished: () => void;
  started: () => void;
};

const syncLabel = (done: number, total: number): string => `Syncing refs: ${done}/${total} done`;

/** Counts a ref as done once its sync settles, failed or not. The line appears as soon as the first
 * ref starts, before any has finished. */
const syncTracker = (spinner: Spinner, total: number): SyncTracker => {
  let done = 0;
  return {
    finished: () => {
      done += 1;
      spinner.update(syncLabel(done, total));
    },
    started: () => {
      spinner.update(syncLabel(done, total));
    },
  };
};

export { syncLabel, syncTracker };
export type { SyncTracker };
