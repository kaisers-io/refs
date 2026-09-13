import type { Spinner } from '../spinner.ts';

// What `refs sync` tells a person at a terminal while it works. Up to four refs sync at once, so
// one line names the count and the refs in flight rather than a single "current" ref.

type SyncTracker = {
  finished: (key: string) => void;
  started: (key: string) => void;
};

// How many in-flight keys the line names before it switches to a count. One: two full keys do not
// fit even a 100-column terminal, and the second would be cut off mid-name.
const NAMED_ACTIVE = 1;

const syncLabel = (done: number, total: number, active: readonly string[]): string => {
  const head = `Syncing refs (${done}/${total} done)`;
  if (active.length === 0) {
    return head;
  }
  const named = active.slice(0, NAMED_ACTIVE).join(', ');
  const rest = active.length > NAMED_ACTIVE ? `, +${active.length - NAMED_ACTIVE}` : '';
  return `${head}: ${named}${rest}`;
};

/** Counts a ref as done once its sync settles, failed or not, and shows only refs that have
 * actually started, not ones still waiting for a slot. */
const syncTracker = (spinner: Spinner, total: number): SyncTracker => {
  const active: string[] = [];
  let done = 0;
  const render = (): void => {
    spinner.update(syncLabel(done, total, active));
  };
  return {
    finished: (key) => {
      active.splice(active.indexOf(key), 1);
      done += 1;
      render();
    },
    started: (key) => {
      active.push(key);
      render();
    },
  };
};

export { syncLabel, syncTracker };
export type { SyncTracker };
