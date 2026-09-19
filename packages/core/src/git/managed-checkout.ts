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
// `dir` — this guard confirms dir carries the marks of a checkout refs produced, not an arbitrary
// git repo a caller happened to point us at: (a) a `.git` entry exists, and (b) `core.hooksPath`
// is the hooks directory it was given, which is the marker `cloneRepo` stamps. Neither check
// re-verifies the hook *scripts*; that's `installHooksGuard`'s job.
//
// The equality is the point, and this used to accept any non-empty value. `cloneRepo` stamps the
// path, not merely something, and the three sibling guards — `add`'s, `doctor`'s and `resolve`'s —
// each compare for equality (`resolve` additionally rejects a duplicate marker and a `.git` that
// is not a directory). There was no bypass while `syncRef` had a single caller that ran the strict
// guard on the same destination immediately before it, but a weaker predicate in the position
// nearest the destructive sequence becomes the operative one the moment a second caller appears —
// and the comment here described the strict check, which is an invitation to add that caller.
//
// The non-empty test survives the equality test rather than being replaced by it. `git config`
// answers exit 0 with an empty value for a key explicitly set to nothing, so equality ALONE would
// accept an unstamped checkout from a caller that passed an empty hooks directory — the same class
// of caller this change exists to protect against.
//
// What it establishes is that the marker matches, not provenance, and `isGitCheckout` accepts any
// `.git` entry rather than proving one. Both are unchanged here and neither is claimed.
const assertManagedCheckout = async (
  runner: Runner,
  dir: string,
  hooksDir: string,
): Promise<void> => {
  if (!isGitCheckout(dir)) {
    throw validationError(notManagedMessage(dir));
  }
  // Local scope only — ambient global/system hooksPath must not mark a repo as refs-managed
  const hooksPath = await runner.run('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: dir,
  });
  const marker = hooksPath.stdout.trim();
  if (hooksPath.exitCode !== SUCCESS_EXIT_CODE || marker === '' || marker !== hooksDir) {
    throw validationError(notManagedMessage(dir));
  }
};

export { assertManagedCheckout, isGitCheckout };
