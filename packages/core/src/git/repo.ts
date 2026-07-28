import { buildSyncResult, excerpt, toBuildSyncResultOpts } from './sync-result.ts';
import type { BuiltSyncResult } from './sync-result.ts';
import type { CloneMode } from '../schemas/primitives.ts';
import type { RefsHome } from '../home.ts';
import type { Runner } from '../proc/runner.ts';
import { assertManagedCheckout } from './managed-checkout.ts';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { validationError } from '../errors.ts';
import { writeFileAtomic } from '../fs-atomic.ts';

// Git operations for a "managed checkout": every function takes `runner: Runner` first (real git
// via SpawnRunner in production, scripted via FakeRunner in unit tests). Implements the clone
// modes, sync semantics, and read-only hook guards for those checkouts.

type CloneOpts = {
  cloneUrl: string;
  dest: string;
  mode: CloneMode;
  hooksDir: string;
};

type CloneResult = {
  effectiveMode: CloneMode;
  warning?: string;
};

type SyncOpts = {
  dir: string;
  defaultBranch: string;
};

// Canonical definitions live in sync-result.ts — re-exported here under this module's
// established public names.
type SyncResult = BuiltSyncResult;

const DEFAULT_TAG_LIMIT = 20;
const SUCCESS_EXIT_CODE = 0;
const HOOK_MODE = 0o755;

// Git's wording (git 2.50.1 / Apple Git-155, verified against a plain `file://` remote —
// see repo.test.ts) when the server ignores `--filter=...` and performs a full clone instead.
const FILTER_NOT_HONOURED_PATTERN = /filtering not recognized/iu;

type CommandSpec = {
  action: string;
  cmd: string;
  args: readonly string[];
  cwd?: string;
};

const cwdOpt = (cwd: string | undefined): { cwd?: string } => {
  if (cwd === undefined) {
    return {};
  }
  return { cwd };
};

// Shorthand for the `{ action, args, cmd: 'git', cwd }` shape passed to `runOrThrow` below.
const gitSpec = (action: string, args: readonly string[], cwd?: string): CommandSpec => ({
  action,
  args,
  cmd: 'git',
  ...cwdOpt(cwd),
});

// Runs one command and throws `validationError` on a non-zero exit — opts IN to "failure is an
// exception" on top of `Runner.run`'s "failure is data" contract, for steps with no sane way to
// continue past a failure (a failed clone/checkout/reset leaves nothing useful to return).
const runOrThrow = async (
  runner: Runner,
  spec: CommandSpec,
): Promise<{ stdout: string; stderr: string }> => {
  const result = await runner.run(spec.cmd, spec.args, cwdOpt(spec.cwd));
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result;
  }
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  throw validationError(`${spec.action} failed: ${detail}`);
};

// `git clone` into `opts.dest` (`--filter=blob:none` when blobless). Some servers (verified: a
// plain `file://` remote without `uploadpack.allowFilter=true`) ignore the filter and warn — that
// downgrades to `effectiveMode: 'full'` + warning. Always configures `core.hooksPath` afterwards.
const cloneRepo = async (runner: Runner, opts: CloneOpts): Promise<CloneResult> => {
  const args = ['clone', '-q'];
  if (opts.mode === 'blobless') {
    args.push('--filter=blob:none');
  }
  args.push(opts.cloneUrl, opts.dest);
  const cloneResult = await runOrThrow(runner, gitSpec('git clone', args));
  await runOrThrow(
    runner,
    gitSpec('git config core.hooksPath', ['config', 'core.hooksPath', opts.hooksDir], opts.dest),
  );

  const filterIgnored =
    opts.mode === 'blobless' && FILTER_NOT_HONOURED_PATTERN.test(cloneResult.stderr);
  if (!filterIgnored) {
    return { effectiveMode: opts.mode };
  }
  return {
    effectiveMode: 'full',
    warning:
      'server did not honour the partial-clone filter (blob:none); fell back to a full clone',
  };
};

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
const detectDefaultBranch = async (runner: Runner, dir: string): Promise<string> => {
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
  await runOrThrow(
    runner,
    gitSpec('git fetch', ['fetch', '--prune', '--tags', 'origin'], opts.dir),
  );
  const setHeadResult = await runner.run('git', ['remote', 'set-head', 'origin', '--auto'], {
    cwd: opts.dir,
  });
  const branch = await detectDefaultBranch(runner, opts.dir);
  const result: { branch: string; branchRenamedTo?: string; warning?: string } = { branch };
  if (branch !== opts.defaultBranch) {
    result.branchRenamedTo = branch;
  }
  if (setHeadResult.exitCode !== SUCCESS_EXIT_CODE) {
    result.warning = `could not refresh origin/HEAD: ${excerpt(setHeadResult)}`;
  }
  return result;
};

// Hard-resets `dir` to `origin/<branch>`: `checkout -B` + `reset --hard` handle force-pushes and
// stray local commits on tracked files. Only when dirty does `clean -fd` also remove untracked
// files/dirs (`reset --hard` leaves them behind; `-x` is deliberately NOT used, so gitignored
// artifacts survive a routine clean sync).
const dirtyCleanupSteps = (dir: string): CommandSpec[] => [
  gitSpec('git reset --hard HEAD (pre-checkout)', ['reset', '--hard', 'HEAD'], dir),
  gitSpec('git clean -fd', ['clean', '-fd'], dir),
];

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
  await assertManagedCheckout(runner, opts.dir);
  const oldSha = await currentSha(runner, opts.dir);
  const syncBranch = await resolveSyncBranch(runner, opts);
  const dirty = await isDirty(runner, opts.dir);
  await hardResetToBranch(runner, { branch: syncBranch.branch, dir: opts.dir, dirty });
  const newSha = await currentSha(runner, opts.dir);
  return buildSyncResult(toBuildSyncResultOpts(syncBranch, dirty, { newSha, oldSha }));
};

/** First `limit` tags, newest-first (`git tag --sort=-version:refname`), or `[]` if none. */
const listTags = async (
  runner: Runner,
  dir: string,
  limit = DEFAULT_TAG_LIMIT,
): Promise<string[]> => {
  const result = await runOrThrow(
    runner,
    gitSpec('git tag', ['tag', '--sort=-version:refname'], dir),
  );
  const tags = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return tags.slice(0, limit);
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
      const path = join(home.hooksDir, name);
      await writeFileAtomic(path, GUARD_HOOK_SCRIPT);
      await chmod(path, HOOK_MODE);
    }),
  );
};

export { isGitCheckout } from './managed-checkout.ts';
export type { SyncStatus } from './sync-result.ts';
export { cloneRepo, detectDefaultBranch, installHooksGuard, listTags, syncRef, tagExists };
export type { CloneResult, SyncResult };
