import type { RefKey, RefState, RefsHome } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { readConfig, readState, withLock, writeConfig, writeState } from '@kaisers-io/refs-core';
import type { RefSyncOutcome } from './sync-checkout.ts';

// Config/state persistence for `sync-core.ts` — split out purely to keep both files under the
// repo's 300-line oxlint cap. Every write here runs under a SEPARATE, short home-lock acquisition,
// sequential after (never nested inside) `sync-checkout.ts#syncCheckout`'s per-ref lock — mirrors
// `add-finalize.ts#finalizeRef`'s own two-step lock sequence. Chosen deliberately per-ref (one
// short home-lock acquisition per ref) rather than batching every ref's state update under a
// single lock at the end of the whole run: a later ref's failure must never lose an earlier ref's
// already-successful state update.

/** Builds `key`'s next `RefState` on a successful sync/clone: a fresh object (not a spread of
 * `previous`) so a prior `last_error`/`pending_proposal_at` is dropped on success rather than
 * lingering — only `effective_clone_mode` is deliberately carried over when this round didn't
 * reclone (and so has no fresher value of its own). */
const buildSyncedState = (previous: RefState | undefined, outcome: RefSyncOutcome): RefState => {
  const next: RefState = { head_sha: outcome.headSha, last_fetched_at: new Date().toISOString() };
  const effectiveCloneMode = outcome.effectiveCloneMode ?? previous?.effective_clone_mode;
  if (effectiveCloneMode !== undefined) {
    next.effective_clone_mode = effectiveCloneMode;
  }
  return next;
};

/** Persists a detected branch rename onto the configured ref's `default_branch` — a no-op if the
 * ref has meanwhile been removed from config (defensive only; `sync`'s targets are always read
 * from config moments earlier). */
const renameDefaultBranch = async (home: RefsHome, key: RefKey, branch: string): Promise<void> => {
  const config = await readConfig(home);
  const entry = config.refs[key];
  if (entry === undefined) {
    return;
  }
  config.refs[key] = { ...entry, default_branch: branch };
  await writeConfig(home, config);
};

/** Persists a successful sync's config/state effects under one short home-lock acquisition. */
const applySyncSuccess = (home: RefsHome, key: RefKey, outcome: RefSyncOutcome): Promise<void> =>
  withLock(home, 'home', async () => {
    if (outcome.branchRenamedTo !== undefined) {
      await renameDefaultBranch(home, key, outcome.branchRenamedTo);
    }
    const state = await readState(home);
    state.refs[key] = buildSyncedState(state.refs[key], outcome);
    await writeState(home, state);
  });

/** Best-effort: records `message` as `key`'s `last_error` under a short home lock, preserving
 * every other field already in state. A failure here (e.g. lock contention) must never mask the
 * real sync failure the caller is already about to report, so it is swallowed rather than thrown —
 * the batch's result item for `key` still carries the original error either way. */
const recordFailure = async (home: RefsHome, key: RefKey, message: string): Promise<void> => {
  try {
    await withLock(home, 'home', async () => {
      const state = await readState(home);
      state.refs[key] = { ...state.refs[key], last_error: message };
      await writeState(home, state);
    });
  } catch {
    // Swallowed by design — see comment above.
  }
};

export { applySyncSuccess, recordFailure };
