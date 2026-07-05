// Shared staleness check: `refs list`'s `[stale]` marker (`list.ts`) and `refs sync --stale-only`'s
// pre-sync filter (`sync.ts`) both need the exact same "is this ref due for a re-fetch" rule, so it
// lives here rather than one command importing the other.

/** Whether a ref's last fetch is stale relative to `ttlMs`: always stale when it has never been
 * fetched (`lastFetchedAt` undefined), otherwise stale once `now` is more than `ttlMs` past it. */
const isStale = (lastFetchedAt: string | undefined, ttlMs: number, now: number): boolean => {
  if (lastFetchedAt === undefined) {
    return true;
  }
  return now - Date.parse(lastFetchedAt) > ttlMs;
};

export { isStale };
