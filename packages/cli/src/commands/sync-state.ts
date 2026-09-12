import type { RefKey, RefState, RefsHome } from '@kaisers-io/refs-core';
import { readConfig, readState, withLock, writeConfig, writeState } from '@kaisers-io/refs-core';
import type { RefSyncOutcome } from './sync-checkout.ts';

// Config/state persistence for `refs sync`. Every write here runs under a SEPARATE, short
// home-lock acquisition, sequential after (never nested inside) `sync-checkout.ts#syncCheckout`'s
// per-ref lock — mirrors `add-finalize.ts#finalizeRef`'s own two-step lock sequence. Chosen
// deliberately per-ref (one short home-lock acquisition per ref) rather than batching every ref's
// state update under a single lock at the end of the whole run: a later ref's failure must never
// lose an earlier ref's already-successful state update.

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

// What a sync failure's message contains is not bounded by anything this side cares about. Most of
// it is git's own stderr, and git quotes what it was working on — ref names among them, which the
// tracked repository chooses. `SpawnRunner` caps each stream at 64 MiB, which stops a runaway
// subprocess; it is not a budget for something written into `state.json` and read back on every
// later command. An upstream with 120 conflicting tags produces one error line per tag.
//
// So the recorded message is capped, and the cut is stated rather than silent: a truncated error
// is still evidence, but only if the reader can tell it is partial.
//
// Head AND tail, not head alone. A git failure puts the command context at the top and its own
// summary and hint at the bottom ("try running 'git remote prune origin'"), and the bottom is the
// half a reader acts on. Neither end guarantees the one line that names the actual cause — that
// can sit anywhere in the middle — which is why the omission count is exact: it says how much
// judgement the reader is missing.
const LAST_ERROR_HEAD_CHARS = 1500;
const LAST_ERROR_TAIL_CHARS = 500;
const MAX_LAST_ERROR_CHARS = LAST_ERROR_HEAD_CHARS + LAST_ERROR_TAIL_CHARS;

const boundedFailure = (message: string): string => {
  if (message.length <= MAX_LAST_ERROR_CHARS) {
    return message;
  }
  const head = message.slice(0, LAST_ERROR_HEAD_CHARS);
  const tail = message.slice(message.length - LAST_ERROR_TAIL_CHARS);
  const omitted = message.length - MAX_LAST_ERROR_CHARS;
  return `${head}\n… ${String(omitted)} characters omitted …\n${tail}`;
};

/** Best-effort: records `message` as `key`'s `last_error` under a short home lock, preserving
 * every other field already in state. A failure here (e.g. lock contention) must never mask the
 * real sync failure the caller is already about to report, so it is swallowed rather than thrown —
 * the batch's result item for `key` still carries the original error either way.
 *
 * The message is capped on the way in (`boundedFailure`); the caller's own result item still
 * carries the full text, so nothing is lost from the run that produced it. */
const recordFailure = async (home: RefsHome, key: RefKey, message: string): Promise<void> => {
  try {
    await withLock(home, 'home', async () => {
      const state = await readState(home);
      state.refs[key] = { ...state.refs[key], last_error: boundedFailure(message) };
      await writeState(home, state);
    });
  } catch {
    // Swallowed by design — see comment above.
  }
};

export { applySyncSuccess, recordFailure };
