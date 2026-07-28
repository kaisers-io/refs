import type { Runner } from '../proc/runner.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { validationError } from '../errors.ts';

const SUCCESS_EXIT_CODE = 0;

/** Whether `dir` is (the top level of) a git checkout — a plain fs check, no `Runner` involved. */
const isGitCheckout = (dir: string): boolean =>
  // eslint-disable-next-line node/no-sync -- cheap synchronous existence check, mirrors home.ts
  existsSync(join(dir, '.git'));

const notManagedMessage = (dir: string): string =>
  `refusing to sync ${dir}: not a refs-managed checkout`;

// `syncRef` runs destructive git operations (checkout -B, reset --hard, clean -fd) against
// `opts.dir` — this guard confirms dir is actually a checkout refs itself produced, not an
// arbitrary git repo a caller happened to point us at: (a) a real `.git` directory exists, and
// (b) `core.hooksPath` is a non-empty value — the marker `cloneRepo` stamps on every managed
// checkout it creates. Neither check re-verifies the hook *scripts*; that's `installHooksGuard`'s
// job.
const assertManagedCheckout = async (runner: Runner, dir: string): Promise<void> => {
  if (!isGitCheckout(dir)) {
    throw validationError(notManagedMessage(dir));
  }
  // Local scope only — ambient global/system hooksPath must not mark a repo as refs-managed
  const hooksPath = await runner.run('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: dir,
  });
  if (hooksPath.exitCode !== SUCCESS_EXIT_CODE || hooksPath.stdout.trim() === '') {
    throw validationError(notManagedMessage(dir));
  }
};

export { assertManagedCheckout, isGitCheckout };
