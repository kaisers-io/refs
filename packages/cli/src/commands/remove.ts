import type { Config, RefKey, RefsHome, State } from '@kaisers-io/refs-core';
import {
  assertInsideSources,
  checkoutPath,
  isEnoent,
  readConfig,
  readState,
  resolveHome,
  withLock,
  writeConfig,
  writeState,
} from '@kaisers-io/refs-core';
import { emit, wrapAction } from '../output.ts';
import { lstat, readdir, rm, rmdir } from 'node:fs/promises';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { dirname } from 'node:path';
import { matchRefKey } from './list.ts';
import { refLockName } from './add-helpers.ts';

// `refs remove <ref>` — the CLI's only destructive command: it always removes BOTH the ref's
// config/state entry AND its checkout directory (deliberately all-or-nothing — there is no flag
// to keep either half).
//
// Ordering (deliberate, see `home.ts`'s destructive-caller contract): the checkout is
// containment-checked (`assertInsideSources`) and deleted FIRST, under the ref's own per-ref lock;
// the config/state entry is dropped SECOND, under the `'home'` lock, only once that succeeds. If
// the containment check throws, or `fs.rm` itself fails, the config entry is left untouched — the
// command can simply be retried, or the offending path inspected by hand, with `refs list` still
// showing the ref as present. The reverse order (drop the entry first, delete second) would instead
// risk leaving an un-tracked, un-removable directory under `sources/` on any post-removal failure —
// recoverable only by manually finding it on disk, which is strictly worse than a retryable no-op.

const MISSING_CHECKOUT_WARNING = 'checkout was already missing';
const NO_WARNINGS: string[] = [];

type RemoveData = {
  key: RefKey;
  removed_checkout: boolean;
};

type RemoveResult = {
  data: RemoveData;
  warnings: string[];
};

// Kept out of `runRemove` only to avoid a ternary there (repo style forbids `no-ternary`),
// mirroring `output.ts`'s `toLines`/`show.ts`'s `warningsFor`.
const warningsFor = (warning: string | undefined): string[] => {
  if (warning === undefined) {
    return NO_WARNINGS;
  }
  return [warning];
};

/** `lstat` rather than `stat` — a DANGLING symlink at `dest` (target missing) must still count as
 * present: `stat` follows the link and would report ENOENT for it, silently skipping the guarded
 * `rm` below and leaving an unmanaged symlink entry under `sources/`. `lstat` sees any fs entry at
 * the path (directory, file, or symlink, dangling or not) without following it. */
const checkoutExists = async (dest: string): Promise<boolean> => {
  try {
    await lstat(dest);
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
};

/** `readdir(dir)`, or `undefined` if `dir` is already gone — mirrors `add-helpers.ts#readDirSafe`
 * (same reasoning: an ENOENT here just means a concurrent pruner or the destructive removal above
 * already won the race, not a real error). */
const readdirSafe = async (dir: string): Promise<string[] | undefined> => {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
};

/** `true`/`false` if `dir` exists (a real directory, or not — most notably a symlink, including
 * one that resolves to a directory), `undefined` if nothing is there at all. `lstat`, not `stat`,
 * so a symlinked ancestor is reported as itself, never silently followed. */
const isRealDirectory = async (dir: string): Promise<boolean | undefined> => {
  try {
    const info = await lstat(dir);
    return info.isDirectory();
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
};

/** The actual `readdir`-then-`rmdir` removal, once `removeIfEmpty` has already confirmed `dir` is
 * a real directory. Same "gone either way" contract as `removeIfEmpty`. */
const removeEmptyDirectory = async (dir: string): Promise<boolean> => {
  const entries = await readdirSafe(dir);
  if (entries === undefined) {
    return true;
  }
  if (entries.length > 0) {
    return false;
  }
  try {
    await rmdir(dir);
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }
  return true;
};

/** Removes `dir` if it exists and is now empty, reporting back whether pruning should continue
 * upward — `true` when `dir` itself is gone (either it was already gone, or this call just removed
 * it), `false` the moment it turns out to be non-empty (some other entry still lives there) OR
 * turns out not to be a real directory at all. */
const removeIfEmpty = async (dir: string): Promise<boolean> => {
  const realDirectory = await isRealDirectory(dir);
  if (realDirectory === undefined) {
    return true;
  }
  if (!realDirectory) {
    // A tampered/unexpected ancestor — e.g. a symlink standing in for a plain directory. `readdir`
    // would follow it transparently (making it look empty), but `rmdir` refuses to remove a path
    // whose final component is a symlink (ENOTDIR) — and that failure would otherwise surface only
    // AFTER the checkout itself was already deleted below it. Conservative: stop pruning here and
    // leave `dir` untouched; `doctor`'s orphan check is the net for anything left behind.
    return false;
  }
  return removeEmptyDirectory(dir);
};

/** Removes now-empty ancestor directories starting at `dir`, walking upward one level at a time,
 * stopping at (and never removing) `home.sourcesDir` itself — e.g. deleting the sole checkout
 * under `github.com/vercel/` also prunes that now-empty `vercel/` directory, and `github.com/`
 * above it if that too is now empty, but `sources/` always survives. Recursive (one `await` per
 * call) — the natural shape for the upward walk. */
const pruneEmptyParents = async (home: RefsHome, dir: string): Promise<void> => {
  if (dir === home.sourcesDir) {
    return;
  }
  const removed = await removeIfEmpty(dir);
  if (!removed) {
    return;
  }
  await pruneEmptyParents(home, dirname(dir));
};

type CheckoutRemoval = {
  removedCheckout: boolean;
  warning?: string;
};

/** Deletes the checkout at `dest` if one is present, containment-checked via `assertInsideSources`
 * immediately before the actual `fs.rm` — per `home.ts`'s destructive-caller contract, which names
 * `refs remove` explicitly as the guard's intended caller — then prunes now-empty parent
 * directories. A checkout that is already absent is not an error: it is reported back as a warning
 * so the caller still proceeds to remove the config/state entry.
 *
 * Residual TOCTOU: `assertInsideSources` re-checks containment then `rm` runs after — a window a
 * concurrent arbitrary filesystem writer could in principle race; accepted for a local single-user
 * tool, same adjudication as `workspaces.ts`'s `isContainedInRepo` note and `home.ts`'s own guard
 * doc. No structural fix here.
 *
 * Two-phase ordering note: if `pruneEmptyParents` throws (e.g. some other unexpected fs error) it
 * does so AFTER the checkout itself is already gone but BEFORE `runRemove` drops the config/state
 * entry — deliberately: that failure surfaces loudly, `refs list` still shows the ref, and a re-run
 * of `refs remove` is a safe, idempotent way to finish the job (`checkoutExists` sees nothing left
 * to remove and `dropRefEntries` clears the now-stale entry). */
const removeCheckout = async (home: RefsHome, dest: string): Promise<CheckoutRemoval> => {
  const present = await checkoutExists(dest);
  if (!present) {
    return { removedCheckout: false, warning: MISSING_CHECKOUT_WARNING };
  }
  assertInsideSources(home, dest);
  await rm(dest, { force: true, recursive: true });
  await pruneEmptyParents(home, dirname(dest));
  return { removedCheckout: true };
};

/** Builds a copy of `record` with `key` omitted — via `Object.fromEntries`/`filter` rather than
 * `delete record[key]`, so config/state objects are never mutated in place. */
const withoutKey = <TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> =>
  Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));

/** Drops `key` from both `config.refs` and `state.refs` under the shared `'home'` lock — the same
 * lock every other config/state mutation in the CLI takes (init, edit, add's finalize step, sync's
 * state updates) — so this can never race a concurrent `refs edit`/`refs add`/`refs sync`. Re-reads
 * both files fresh under the lock rather than reusing an earlier read, mirroring
 * `add-helpers.ts#ensureNoConflict`'s "checked once outside, re-verified inside the lock"
 * discipline. A key already absent (e.g. dropped by a racing caller) is a harmless no-op. */
const dropRefEntries = async (home: RefsHome, key: RefKey): Promise<void> => {
  const config = await readConfig(home);
  const updatedConfig: Config = { ...config, refs: withoutKey(config.refs, key) };
  await writeConfig(home, updatedConfig);
  const state = await readState(home);
  const updatedState: State = { ...state, refs: withoutKey(state.refs, key) };
  await writeState(home, updatedState);
};

// Accepted cross-command race: a `refs sync` that resolved its targets from config BEFORE this
// removal can acquire the ref lock right after the checkout deletion below, re-clone from its
// stale context, and write state for a ref no longer in config. Worst case is an orphaned
// checkout plus a stale state entry — no data loss, no containment escape; `refs doctor`'s orphan
// check reports the leftover and state is self-healing by design. Full cross-command
// transactionality was deliberately not a design goal for this local single-user tool.
const runRemove = async (ctx: CliContext, query: string): Promise<RemoveResult> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const key = matchRefKey(config, query);
  const dest = checkoutPath(home, key);

  const { removedCheckout, warning } = await withLock(home, refLockName(key), () =>
    removeCheckout(home, dest),
  );
  await withLock(home, 'home', () => dropRefEntries(home, key));

  return { data: { key, removed_checkout: removedCheckout }, warnings: warningsFor(warning) };
};

const removeHuman = (data: RemoveData): string[] => {
  if (data.removed_checkout) {
    return [`removed ${data.key} (checkout deleted)`];
  }
  return [`removed ${data.key} (checkout was already missing)`];
};

const registerRemove = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('remove')
    .description('Remove a configured ref: its config/state entry AND its checkout directory.')
    .argument('<ref>', 'full ref key or a unique suffix, e.g. zod')
    .action((ref, _localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const { data, warnings } = await runRemove(ctx, ref);
        emit(ctx, opts, removeHuman(data), data, warnings);
      })();
    });
};

export { registerRemove, runRemove };
export type { RemoveData };
