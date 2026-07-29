import type { RefSyncContext, RefSyncOutcome, SyncStatus } from './sync-checkout.ts';
import { applySyncSuccess, recordFailure } from './sync-state.ts';
import { createSemaphore, runGated } from './sync-semaphore.ts';
import type { CliContext } from '../context.ts';
import { errorMessageOf } from '../output.ts';
import { syncCheckout } from './sync-checkout.ts';

// Batch orchestration for `refs sync`: wires one ref's start-to-finish outcome (git ops, then
// persistence, never throwing) and the capped-concurrency batch over all targets. Per-ref git ops
// live in `sync-checkout.ts`, config/state persistence in `sync-state.ts`, the concurrency
// primitive in `sync-semaphore.ts`.

type SyncItemStatus = SyncStatus | 'failed';

type SyncResultItem = {
  key: string;
  status: SyncItemStatus;
  error?: string;
  warning?: string;
};

const RENAME_WARNING_SEP = ' | ';

/** Merges the branch-rename warning (if any) with `outcome`'s own warning (e.g. a partial-clone
 * filter fallback) — both can legitimately fire for the same ref. */
const buildWarning = (outcome: RefSyncOutcome): string | undefined => {
  const parts: string[] = [];
  if (outcome.branchRenamedTo !== undefined) {
    parts.push(`default branch renamed to ${outcome.branchRenamedTo}`);
  }
  if (outcome.warning !== undefined) {
    parts.push(outcome.warning);
  }
  const [firstPart] = parts;
  if (firstPart === undefined) {
    return undefined;
  }
  return parts.join(RENAME_WARNING_SEP);
};

const buildSuccessItem = (key: string, outcome: RefSyncOutcome): SyncResultItem => {
  const result: SyncResultItem = { key, status: outcome.status };
  const warning = buildWarning(outcome);
  if (warning !== undefined) {
    result.warning = warning;
  }
  return result;
};

/** One ref, start to finish: git ops under the per-ref lock (`sync-checkout.ts`), then
 * config/state persistence under a separate home lock (`sync-state.ts`) — never throws; any
 * failure (git op, lock timeout, validation) is caught here and reported as a `'failed'` result
 * item instead of aborting the batch. */
const syncOneKey = async (ctx: CliContext, rsc: RefSyncContext): Promise<SyncResultItem> => {
  try {
    const outcome = await syncCheckout(ctx, rsc);
    await applySyncSuccess(rsc.home, rsc.key, outcome);
    return buildSuccessItem(rsc.key, outcome);
  } catch (error) {
    const message = errorMessageOf(error);
    await recordFailure(rsc.home, rsc.key, message);
    return { error: message, key: rsc.key, status: 'failed' };
  }
};

// Cap on how many refs `syncAll` syncs at once — a named constant per the repo's no-magic-numbers
// style, not tuned against any particular measurement.
const SYNC_CONCURRENCY_CAP = 4;

/** Reshapes one `Promise.allSettled` slot back into a `SyncResultItem` — the `'rejected'` branch
 * is pure defense-in-depth (`syncOneKey` above already catches everything it can), so the batch
 * still degrades to a `'failed'` entry instead of crashing outright if something truly unexpected
 * slips past it (e.g. a bug in the semaphore wiring itself). */
const toResultItem = (
  settled: PromiseSettledResult<SyncResultItem>,
  key: string,
): SyncResultItem => {
  /* v8 ignore next 3 -- defense-in-depth per the doc comment above: `syncOneKey` catches
     everything, so a rejected slot cannot be produced without a bug in the semaphore wiring. */
  if (settled.status === 'rejected') {
    return { error: errorMessageOf(settled.reason), key, status: 'failed' };
  }
  return settled.value;
};

/** Syncs every target in `targets`, at most `SYNC_CONCURRENCY_CAP` at a time, via
 * `Promise.allSettled` over a tiny inline semaphore (`sync-semaphore.ts`) — the batch never
 * aborts: each target's own failure (or, in the defensive fallback above, a rejection `syncOneKey`
 * somehow didn't catch) becomes its own `'failed'` result item alongside every other target's real
 * outcome. */
const syncAll = async (
  ctx: CliContext,
  targets: readonly RefSyncContext[],
): Promise<SyncResultItem[]> => {
  const sem = createSemaphore(SYNC_CONCURRENCY_CAP);
  const settled = await Promise.allSettled(
    targets.map((rsc) => runGated(sem, () => syncOneKey(ctx, rsc))),
  );
  return settled.map((outcome, index) => {
    const target = targets[index];
    /* v8 ignore next 5 -- `settled` is produced by mapping over `targets`, so it is always the
       same length; this only satisfies `noUncheckedIndexedAccess` and can never actually
       trigger. */
    if (target === undefined) {
      throw new Error(`internal: sync target at index ${index} is missing`);
    }
    return toResultItem(outcome, target.key);
  });
};

export { syncAll };
export type { SyncItemStatus, SyncResultItem };
