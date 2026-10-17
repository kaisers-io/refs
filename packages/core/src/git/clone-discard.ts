import type { RunResult, Runner } from '../proc/runner.ts';
import { gitSpec, runOrThrow } from './run-or-throw.ts';
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validationError } from '../errors.ts';

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
//
// Neither fact says the clone has stopped writing. When the timeout could not confirm that every
// process the clone started has ended (`RunResult.cleanupUncertain`, spawn-confirm.ts), removing
// `dest` would race whatever still writes into it, and a survivor could recreate part of it after
// the removal. The leftover is then kept, and only its `core.hooksPath` marker is unset: every
// reuse path compares that marker before adopting a checkout, so the next `refs add` or
// `refs sync` refuses it instead of taking it for a healthy one.

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

/** `runner`, noting whether any run it made reported `cleanupUncertain`. */
const watchingCleanup = (runner: Runner): { runner: Runner; uncertain: () => boolean } => {
  let uncertain = false;
  return {
    runner: {
      run: async (cmd, args, opts) => {
        const result = await runner.run(cmd, args, opts);
        uncertain ||= result.cleanupUncertain === true;
        return result;
      },
    },
    uncertain: () => uncertain,
  };
};

/** Leaves the leftover at `dest` in place but unadoptable, and answers the error that says so. */
const quarantine = async (runner: Runner, dest: string, error: unknown): Promise<Error> => {
  await runner.run('git', ['config', '--local', '--unset', 'core.hooksPath'], { cwd: dest });
  const detail = error instanceof Error ? error.message : String(error);
  return validationError(
    `${detail} — processes the clone started may still be running, so refs left ${dest} in ` +
      'place and unmarked it; refs will not use it, remove it once they have exited',
  );
};

type FailedClone = { dest: string; existed: boolean; runner: Runner; uncertain: boolean };

/** Removes or quarantines what the failed clone left, if it left anything; answers the error to
 * throw. */
const afterFailure = async (failed: FailedClone, error: unknown): Promise<unknown> => {
  if (!(await isLeftover(failed.dest, failed.existed))) {
    return error;
  }
  if (failed.uncertain) {
    return quarantine(failed.runner, failed.dest, error);
  }
  await rm(failed.dest, { force: true, maxRetries: CLEANUP_RETRIES, recursive: true });
  return error;
};

/** Runs the clone and stamps the marker, removing `opts.dest` again if either fails and it holds
 * a clone this call started. */
const cloneOrDiscard = async (
  runner: Runner,
  opts: DiscardOpts,
  args: readonly string[],
): Promise<RunResult> => {
  const existed = await entryExists(opts.dest);
  const watched = watchingCleanup(runner);
  try {
    const result = await runOrThrow(watched.runner, gitSpec('git clone', args));
    // Kept deliberately, though the clone's own `-c` already wrote it: an older git that does not
    // apply a clone `-c` before checkout would still leave the marker every later guard compares
    // against. Re-writing the same value is idempotent.
    await runOrThrow(
      runner,
      gitSpec('git config core.hooksPath', ['config', 'core.hooksPath', opts.hooksDir], opts.dest),
    );
    return result;
  } catch (error) {
    const failed = { dest: opts.dest, existed, runner, uncertain: watched.uncertain() };
    throw await afterFailure(failed, error);
  }
};

export { cloneOrDiscard };
