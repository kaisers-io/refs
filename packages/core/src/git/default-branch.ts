import type { Runner } from '../proc/runner.ts';
import { validationError } from '../errors.ts';

const SUCCESS_EXIT_CODE = 0;
const ORIGIN_PREFIX = 'origin/';

// One attempt at resolving `origin/HEAD`; `undefined` if the ref doesn't exist (yet) — the caller
// decides whether to refresh and retry.
const tryReadOriginHead = async (runner: Runner, dir: string): Promise<string | undefined> => {
  const result = await runner.run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    cwd: dir,
  });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    return undefined;
  }
  const branch = result.stdout.trim();
  return branch.startsWith(ORIGIN_PREFIX) ? branch.slice(ORIGIN_PREFIX.length) : branch;
};

// Resolves the remote's default branch via `refs/remotes/origin/HEAD`; if stale/absent, refreshes
// with `git remote set-head origin --auto` and retries once. Throws if still undetectable.
//
// The fallback `set-head` WRITES `refs/remotes/origin/HEAD`, and from git 2.54 that ref update runs
// `reference-transaction`, from an inherited command-scope `core.hooksPath=.githooks` too. What
// keeps that from running a hook the checkout tracks is the pin the CLI puts on every git call
// (`pinned-hooks.ts`). Measured on git 2.54.0 and 2.55.0; git 2.43 runs no hook here.
const readDefaultBranch = async (runner: Runner, dir: string): Promise<string> => {
  const direct = await tryReadOriginHead(runner, dir);
  if (direct !== undefined) {
    return direct;
  }
  await runner.run('git', ['remote', 'set-head', 'origin', '--auto'], { cwd: dir });
  const retried = await tryReadOriginHead(runner, dir);
  if (retried !== undefined) {
    return retried;
  }
  throw validationError(`could not detect the default branch for checkout: ${dir}`);
};

export { readDefaultBranch };
