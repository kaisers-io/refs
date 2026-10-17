import { buildSyncResult, excerpt, toBuildSyncResultOpts } from './sync-result.ts';
import { gitSpec, runOpts, runOrThrow } from './run-step.ts';
import type { BuiltSyncResult } from './sync-result.ts';
import type { CommandSpec } from './run-step.ts';
import type { RefsHome } from '../home.ts';
import type { Runner } from '../proc/runner.ts';
import { join } from 'node:path';
import { prepareManagedCheckout } from './managed-checkout.ts';
import { validationError } from '../errors.ts';
import { writeFileAtomic } from '../fs-atomic.ts';

// Git operations for a "managed checkout": every function takes `runner: Runner` first (real git
// via SpawnRunner in production, scripted via FakeRunner in unit tests). Implements the clone
// modes, sync semantics, and read-only hook guards for those checkouts.

type SyncOpts = {
  dir: string;
  defaultBranch: string;
  /** This home's hooks directory: what `core.hooksPath` must equal for the checkout to be one
   * refs produced. See `assertManagedCheckout`. */
  hooksDir: string;
  /** Deadline for each command that talks to the remote; absent means none. */
  networkTimeoutMs?: number;
};

// Canonical definitions live in sync-result.ts — re-exported here under this module's
// established public names.
type SyncResult = BuiltSyncResult;

const SUCCESS_EXIT_CODE = 0;
const HOOK_MODE = 0o755;
// Contacts the remote, so it runs under the same network deadline as clone and fetch.
const SET_HEAD_ARGS = ['remote', 'set-head', 'origin', '--auto'] as const;

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
  const ORIGIN_PREFIX = 'origin/';
  if (branch.startsWith(ORIGIN_PREFIX)) {
    return branch.slice(ORIGIN_PREFIX.length);
  }
  return branch;
};

// Resolves the remote's default branch via `refs/remotes/origin/HEAD`; if stale/absent, refreshes
// with `git remote set-head origin --auto` and retries once. Throws if still undetectable.
const detectDefaultBranch = async (
  runner: Runner,
  dir: string,
  networkTimeoutMs?: number,
): Promise<string> => {
  const direct = await tryReadOriginHead(runner, dir);
  if (direct !== undefined) {
    return direct;
  }
  await runner.run('git', SET_HEAD_ARGS, runOpts(dir, networkTimeoutMs));
  const retried = await tryReadOriginHead(runner, dir);
  if (retried !== undefined) {
    return retried;
  }
  throw validationError(`could not detect the default branch for checkout: ${dir}`);
};

const currentSha = async (runner: Runner, dir: string): Promise<string> => {
  const result = await runOrThrow(
    runner,
    gitSpec('git rev-parse HEAD', ['rev-parse', 'HEAD'], dir),
  );
  return result.stdout.trim();
};

const isDirty = async (runner: Runner, dir: string): Promise<boolean> => {
  const result = await runOrThrow(
    runner,
    gitSpec('git status --porcelain', ['status', '--porcelain'], dir),
  );
  return result.stdout.trim() !== '';
};

// Fetches, refreshes `origin/HEAD`, and re-detects the default branch — the first half of
// `syncRef`.
//
// `git remote set-head --auto` is a metadata refresh, not the fetch itself: the fetch above
// already succeeded, so a failure here must NOT throw and abort the sync — it only means a branch
// rename may go undetected this round, surfaced instead as a warning on the `SyncResult`.
const resolveSyncBranch = async (
  runner: Runner,
  opts: SyncOpts,
): Promise<{ branch: string; branchRenamedTo?: string; warning?: string }> => {
  const fetch = gitSpec('git fetch', ['fetch', '--prune', '--tags', 'origin'], opts.dir);
  await runOrThrow(runner, { ...fetch, ...runOpts(undefined, opts.networkTimeoutMs) });
  const setHeadResult = await runner.run(
    'git',
    SET_HEAD_ARGS,
    runOpts(opts.dir, opts.networkTimeoutMs),
  );
  const branch = await detectDefaultBranch(runner, opts.dir, opts.networkTimeoutMs);
  const result: { branch: string; branchRenamedTo?: string; warning?: string } = { branch };
  if (branch !== opts.defaultBranch) {
    result.branchRenamedTo = branch;
  }
  if (setHeadResult.exitCode !== SUCCESS_EXIT_CODE) {
    result.warning = `could not refresh origin/HEAD: ${excerpt(setHeadResult)}`;
  }
  return result;
};

// The two scrub steps that run before `checkout -B` when the tree is dirty: `reset --hard HEAD`
// clears tracked-file modifications, `clean -fd` removes untracked files/dirs (`-x` is
// deliberately NOT used, so gitignored artifacts survive a routine clean sync).
const dirtyCleanupSteps = (dir: string): CommandSpec[] => [
  gitSpec('git reset --hard HEAD (pre-checkout)', ['reset', '--hard', 'HEAD'], dir),
  gitSpec('git clean -fd', ['clean', '-fd'], dir),
];

// Hard-resets `dir` to `origin/<branch>`: `checkout -B` + `reset --hard` handle force-pushes and
// stray local commits on tracked files.
//
// A dirty checkout is scrubbed BEFORE `checkout -B`, not after: an untracked local file whose path
// the fetched branch now tracks makes `checkout -B` refuse to overwrite it, so the restore path
// would throw exactly when it is needed. `reset --hard HEAD` clears tracked-file modifications
// blocking the checkout, `clean -fd` clears the untracked collider, and only then do
// `checkout -B` + `reset --hard origin/<branch>` run.
const hardResetToBranch = async (
  runner: Runner,
  opts: { dir: string; branch: string; dirty: boolean },
): Promise<void> => {
  const { branch, dir, dirty } = opts;
  const steps: CommandSpec[] = [];
  if (dirty) {
    steps.push(...dirtyCleanupSteps(dir));
  }
  steps.push(
    gitSpec('git checkout -B', ['checkout', '-B', branch, `origin/${branch}`], dir),
    gitSpec('git reset --hard', ['reset', '--hard', `origin/${branch}`], dir),
  );
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop -- git steps are order-dependent; each must complete before the next runs
    await runOrThrow(runner, step);
  }
};

/**
 * Runs the sync sequence under the caller's per-ref lock: guard against an unmanaged
 * checkout, fetch, refresh `origin/HEAD` and re-detect the default branch (rename →
 * `branchRenamedTo`), snapshot dirtiness, then hard-reset to `origin/<branch>` — see
 * `buildSyncResult` (sync-result.ts) for the status/warning semantics.
 */
const syncRef = async (runner: Runner, opts: SyncOpts): Promise<SyncResult> => {
  await prepareManagedCheckout(runner, opts.dir, opts.hooksDir);
  const oldSha = await currentSha(runner, opts.dir);
  const syncBranch = await resolveSyncBranch(runner, opts);
  const dirty = await isDirty(runner, opts.dir);
  await hardResetToBranch(runner, { branch: syncBranch.branch, dir: opts.dir, dirty });
  const newSha = await currentSha(runner, opts.dir);
  return buildSyncResult(toBuildSyncResultOpts(syncBranch, dirty, { newSha, oldSha }));
};

// `show-ref --verify` checks the LITERAL ref name, unlike `rev-parse --verify` — which also
// resolves git revision syntax (e.g. `refs/tags/v1.0.0^{}` peels against an existing `v1.0.0` tag).
// A crafted version rendered through a `tag_format` must never be treated as a match just because
// it happens to parse as valid revision syntax against a real tag. The `--` guards a tag whose
// literal name looks option-like (e.g. `-weird`) from being parsed as a flag.
const SHOW_REF_SEPARATOR = '--';

/** Whether `tag` resolves to a real annotated/lightweight tag ref in `dir` — a literal ref-name
 * check, not git revision-syntax resolution. */
const tagExists = async (runner: Runner, dir: string, tag: string): Promise<boolean> => {
  const result = await runner.run(
    'git',
    ['show-ref', '--verify', SHOW_REF_SEPARATOR, `refs/tags/${tag}`],
    { cwd: dir },
  );
  return result.exitCode === SUCCESS_EXIT_CODE;
};

const GUARD_HOOK_SCRIPT = [
  '#!/bin/sh',
  'echo "refs: this checkout is a managed read-only reference — commits are blocked" >&2',
  'exit 1',
  '',
].join('\n');

// Writes `hooks/pre-commit` + `hooks/pre-push` (0o755) into the shared hooks dir: with
// `core.hooksPath` pointed here per checkout (`cloneRepo`), git rejects any commit/push there.
const installHooksGuard = async (home: RefsHome): Promise<void> => {
  await Promise.all(
    ['pre-commit', 'pre-push'].map(async (name) => {
      await writeFileAtomic(join(home.hooksDir, name), GUARD_HOOK_SCRIPT, HOOK_MODE);
    }),
  );
};

export { cloneRepo } from './clone.ts';
export { gitSpec, runOrThrow } from './run-step.ts';
export type { CloneResult } from './clone.ts';
export { isGitCheckout } from './managed-checkout.ts';
export type { SyncStatus } from './sync-result.ts';
export { detectDefaultBranch, installHooksGuard, syncRef, tagExists };
export type { SyncResult };
