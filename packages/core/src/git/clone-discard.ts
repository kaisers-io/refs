import type { RunResult, Runner } from '../proc/runner.ts';
import { gitSpec, runOrThrow } from './run-or-throw.ts';
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';

// The clone step of `cloneRepo` (repo.ts), with the removal of what a failed clone leaves behind.
//
// git removes a destination it created when it fails or gets SIGTERM, but not when it gets
// SIGKILL, which is where a command timeout escalates (spawn-timeout.ts). What survives then
// carries `.git` and the `core.hooksPath` marker from the clone's own `-c`, so the next
// `refs add` or `refs sync` would adopt it as a healthy checkout.
//
// Removal needs two facts, and each closes a case where it would otherwise delete something that
// is not this clone's:
// - `dest` was absent before the clone. Checked with `lstat`, so a symlink at `dest` counts as
//   present even when it dangles; and only ENOENT counts as absent, so a path refs could not look
//   at is never treated as one it created.
// - `dest/.git` exists afterwards. A clone that got as far as writing anything adoptable has
//   written that. A `dest` without it is one git refused ("already exists and is not an empty
//   directory") because something else created it after the check above: a concurrent run for a
//   nested ref (`host/group/project/sub`) creates its parent, which is this `dest`, under a lock
//   of its own. Nothing without `.git` can be adopted, so leaving it costs nothing.
// Callers have already containment-checked `dest` and hold the ref's lock.

type DiscardOpts = { dest: string; hooksDir: string };

// `rm`'s retries for a directory a just-killed writer may still be releasing.
const CLEANUP_RETRIES = 3;

/** Whether anything is at `path`, symlinks included. Only ENOENT counts as absent. */
const entryExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
};

/** Whether `dest` is what a failed clone that refs started left behind; see the header. */
const isLeftover = async (dest: string, existed: boolean): Promise<boolean> =>
  !existed && (await entryExists(join(dest, '.git')));

/** Runs the clone and stamps the marker, removing `opts.dest` again if either fails and it holds
 * a clone this call started. */
const cloneOrDiscard = async (
  runner: Runner,
  opts: DiscardOpts,
  args: readonly string[],
): Promise<RunResult> => {
  const existed = await entryExists(opts.dest);
  try {
    const result = await runOrThrow(runner, gitSpec('git clone', args));
    // Kept deliberately, though the clone's own `-c` already wrote it: an older git that does not
    // apply a clone `-c` before checkout would still leave the marker every later guard compares
    // against. Re-writing the same value is idempotent.
    await runOrThrow(
      runner,
      gitSpec('git config core.hooksPath', ['config', 'core.hooksPath', opts.hooksDir], opts.dest),
    );
    return result;
  } catch (error) {
    if (await isLeftover(opts.dest, existed)) {
      await rm(opts.dest, { force: true, maxRetries: CLEANUP_RETRIES, recursive: true });
    }
    throw error;
  }
};

export { cloneOrDiscard };
