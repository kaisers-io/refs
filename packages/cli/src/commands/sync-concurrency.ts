import { usageError } from '@kaisers-io/refs-core';

// `refs sync --concurrency <n>`: how many refs one invocation syncs at once. A flag rather than a
// config setting — how hard to hit a host is a property of this run (a CI cache warm-up, a slow
// link), and a per-ref config value would have no meaning for a batch.
//
// Bounded at both ends: 1 serialises, and the ceiling keeps one batch from starting dozens of
// clones against one host's rate limits. Out of range is refused with the range, never quietly
// clamped: a value the user typed that silently means something else is how a cap goes unnoticed.

const DEFAULT_SYNC_CONCURRENCY = 4;
const MAX_SYNC_CONCURRENCY = 16;
const WHOLE_NUMBER = /^[1-9]\d{0,5}$/u;

/** The concurrency `raw` asks for, `DEFAULT_SYNC_CONCURRENCY` when absent; throws a usage error
 * naming the range for anything else. */
const syncConcurrencyFrom = (raw?: string): number => {
  if (raw === undefined) {
    return DEFAULT_SYNC_CONCURRENCY;
  }
  const value = WHOLE_NUMBER.test(raw) ? Number(raw) : Number.NaN;
  if (!(value <= MAX_SYNC_CONCURRENCY)) {
    throw usageError(
      `--concurrency must be a whole number from 1 to ${String(MAX_SYNC_CONCURRENCY)} — got '${raw}'`,
    );
  }
  return value;
};

export { DEFAULT_SYNC_CONCURRENCY, MAX_SYNC_CONCURRENCY, syncConcurrencyFrom };
