import type { Config, RefsHome } from '@kaisers-io/refs-core';
import { access, constants } from 'node:fs/promises';
import { checkoutPath, isGitCheckout, zRefKey } from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import { join } from 'node:path';

// `hooks-guard` and `dirty-checkouts` — the two checks that iterate configured refs whose checkout
// currently exists, each running one `git` command per checkout via the injected `Runner`.
// The shared existingCheckouts filter is exported so doctor.ts never has to recompute or
// reconcile two independently-derived checkout lists.

const SUCCESS_EXIT_CODE = 0;

type ExistingCheckout = {
  dest: string;
  key: string;
};

/** Every configured ref whose checkout directory currently exists on disk — a ref with a missing
 * checkout is out of scope for both checks below (`refs list`/`refs sync` already surface that
 * state elsewhere; there is nothing to probe with `git` against a directory that isn't there). */
const existingCheckouts = (home: RefsHome, config: Config): ExistingCheckout[] =>
  Object.keys(config.refs)
    .map((key) => ({ dest: checkoutPath(home, zRefKey.parse(key)), key }))
    .filter((item) => isGitCheckout(item.dest));

const PRE_COMMIT_HOOK_NAME = 'pre-commit';
const PRE_PUSH_HOOK_NAME = 'pre-push';
// Both hooks are installed together by core's installHooksGuard (the read-only guard covers
// commits AND pushes). The guard is only intact when BOTH are present and executable, so this
// check fails if either one is missing — never just pre-commit.
const GUARD_HOOK_NAMES = [PRE_COMMIT_HOOK_NAME, PRE_PUSH_HOOK_NAME] as const;

const hookExecutable = async (home: RefsHome, name: string): Promise<boolean> => {
  try {
    await access(join(home.hooksDir, name), constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Every guard hook name that is missing or not executable — empty when both are present, naming
 * whichever one(s) failed rather than collapsing to a single generic "hooks missing" message. */
const missingGuardHooks = async (home: RefsHome): Promise<string[]> => {
  const flags = await Promise.all(GUARD_HOOK_NAMES.map((name) => hookExecutable(home, name)));
  return GUARD_HOOK_NAMES.filter((_name, index) => !flags[index]);
};

/** Whether `dest`'s `core.hooksPath` points at THIS home's hooks directory — the same marker
 * `cloneRepo`/`ensureManagedCheckout` (core) stamp/verify elsewhere, re-checked here per-checkout
 * as `doctor`'s own read-only-guard integrity sweep. */
const checkoutHooksPathOk = async (
  ctx: CliContext,
  home: RefsHome,
  dest: string,
): Promise<boolean> => {
  const result = await ctx.runner.run('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: dest,
  });
  return result.exitCode === SUCCESS_EXIT_CODE && result.stdout.trim() === home.hooksDir;
};

const buildHooksGuardResult = (opts: {
  badKeys: readonly string[];
  checkoutCount: number;
  missingHooks: readonly string[];
}): CheckResult => {
  if (opts.missingHooks.length > 0) {
    const names = opts.missingHooks.map((name) => `hooks/${name}`).join(', ');
    return {
      detail: `${names} missing or not executable — run: refs init`,
      name: 'hooks-guard',
      status: 'fail',
    };
  }
  if (opts.badKeys.length > 0) {
    return {
      detail: `core.hooksPath not set for: ${opts.badKeys.join(', ')} — run: refs init`,
      name: 'hooks-guard',
      status: 'fail',
    };
  }
  const guardedNames = GUARD_HOOK_NAMES.map((name) => `hooks/${name}`).join(', ');
  return {
    detail: `${guardedNames} present; ${opts.checkoutCount} checkout(s) guarded`,
    name: 'hooks-guard',
    status: 'ok',
  };
};

const checkHooksGuard = async (
  ctx: CliContext,
  home: RefsHome,
  config: Config,
): Promise<CheckResult> => {
  const checkouts = existingCheckouts(home, config);
  const [missingHooks, hooksPathFlags] = await Promise.all([
    missingGuardHooks(home),
    Promise.all(checkouts.map((item) => checkoutHooksPathOk(ctx, home, item.dest))),
  ]);
  const badKeys = checkouts
    .filter((_item, index) => !hooksPathFlags[index])
    .map((item) => item.key);
  return buildHooksGuardResult({ badKeys, checkoutCount: checkouts.length, missingHooks });
};

type CheckoutStatus = {
  broken: boolean;
  detail: string;
  dirty: boolean;
  key: string;
};

/** A non-zero exit from `git status --porcelain` (e.g. a stripped/corrupt `.git`, permissions
 * denied on the working tree) means the checkout couldn't be inspected at all — that is a
 * `broken` checkout, distinct from (and reported instead of) a merely `dirty` one: an empty
 * `stdout` from a FAILED command is not the same fact as an empty `stdout` from a SUCCESSFUL one,
 * and treating them alike would silently report a broken checkout as clean. */
const checkoutStatusFor = async (
  ctx: CliContext,
  item: ExistingCheckout,
): Promise<CheckoutStatus> => {
  const result = await ctx.runner.run('git', ['status', '--porcelain'], { cwd: item.dest });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    return { broken: true, detail: result.stderr.trim(), dirty: false, key: item.key };
  }
  return { broken: false, detail: '', dirty: result.stdout.trim() !== '', key: item.key };
};

const buildDirtyCheckoutsResult = (statuses: readonly CheckoutStatus[]): CheckResult => {
  const broken = statuses.filter((status) => status.broken);
  if (broken.length > 0) {
    const detail = broken
      .map((status) => `${status.key}: git status failed — ${status.detail}`)
      .join('; ');
    return { detail, name: 'dirty-checkouts', status: 'fail' };
  }
  const dirtyKeys = statuses.filter((status) => status.dirty).map((status) => status.key);
  if (dirtyKeys.length === 0) {
    return { detail: 'no local changes in any checkout', name: 'dirty-checkouts', status: 'ok' };
  }
  return {
    detail: `local changes will be discarded on next sync: ${dirtyKeys.join(', ')}`,
    name: 'dirty-checkouts',
    status: 'warn',
  };
};

const checkDirtyCheckouts = async (
  ctx: CliContext,
  home: RefsHome,
  config: Config,
): Promise<CheckResult> => {
  const checkouts = existingCheckouts(home, config);
  const statuses = await Promise.all(checkouts.map((item) => checkoutStatusFor(ctx, item)));
  return buildDirtyCheckoutsResult(statuses);
};

export { checkDirtyCheckouts, checkHooksGuard, existingCheckouts };
