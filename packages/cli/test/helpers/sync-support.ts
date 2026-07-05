import type { RefEntry, RefsHome } from '@kaisers-io/refs-core';
import { initHome, parseLastEnvelope, realContextFor } from './add-support.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { readConfig, readState, resolveHome } from '@kaisers-io/refs-core';
import type { CliContext } from '../../src/context.ts';
import type { FixtureRepo } from './fixture-repo.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { createFixtureRepo } from './fixture-repo.ts';
import { execa } from 'execa';
import { expect } from 'vitest';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { writeFile } from 'node:fs/promises';

// Scaffolding specific to `sync.test.ts` — kept out of `add-support.ts` purely to keep both helper
// files under the repo's 300-line oxlint cap. Reuses `add-support.ts`'s own scaffolding
// (`realContextFor`, `initHome`, `parseLastEnvelope`, `withTempHome`, `withResetExitCode`) rather
// than duplicating it.

const GIT_SUCCESS_EXIT_CODE = 0;
const DEFAULT_TAGS = ['v1.0.0'];

/** Runs a git command for test SETUP only (never the code under test) — a throwaway `execa` call
 * rather than pulling in `ExecaRunner`, mirroring `fixture-repo.ts`/`add-guards-support.ts`'s own
 * local `git` helpers (duplicated here for the same reason: no cross-file test-only dependency,
 * and each helper file stays self-contained). */
const gitFor = async (dir: string, args: readonly string[]): Promise<string> => {
  const result = await execa('git', args, { cwd: dir, reject: false });
  if (result.exitCode !== GIT_SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
};

/** Commits a new file directly into the upstream fixture repo (`dir` — the "remote" `refs add`
 * cloned from) — advances its `main` HEAD, simulating an upstream change for the (a) `updated`
 * sync case. */
const commitNewFileTo = async (dir: string, name: string, content: string): Promise<void> => {
  await writeFile(join(dir, name), content);
  await gitFor(dir, ['add', '-A']);
  await gitFor(dir, ['commit', '-q', '-m', `add ${name}`]);
};

/** Current `HEAD` sha of a git dir (upstream fixture OR a local checkout) — used to assert a
 * sync's resulting `head_sha` matches exactly what the remote/checkout landed on. */
const headShaOf = (dir: string): Promise<string> => gitFor(dir, ['rev-parse', 'HEAD']);

interface AddedRef {
  dest: string;
  entry: RefEntry;
  key: string;
}

/** Runs `refs add <source> --description <description> --json` and returns the finalized
 * `{key, entry}` plus the real local checkout path — the common "get a real configured ref with a
 * real checkout" setup step every `sync.test.ts` case needs. */
const addRefViaDescription = async (
  ctx: CliContext,
  stdout: string[],
  source: string,
): Promise<AddedRef> => {
  await run(ctx, ['node', 'refs', 'add', source, '--description', 'A fixture repo.', '--json']);
  const envelope = parseLastEnvelope(stdout) as { data: { entry: RefEntry; key: string } };
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const entry = config.refs[envelope.data.key];
  if (entry === undefined) {
    throw new Error(`test setup: '${envelope.data.key}' was not configured after refs add`);
  }
  const dest = join(home.sourcesDir, ...envelope.data.key.split('/'));
  return { dest, entry, key: envelope.data.key };
};

interface SyncedRefFixture {
  added: AddedRef;
  ctx: CliContext;
  fixture: FixtureRepo;
  home: RefsHome;
  stdout: string[];
}

/** Bootstraps a fresh temp home, inits it, seeds one fixture repo, and adds it as a real
 * configured ref (real checkout) — the common setup every single-ref `sync.test.ts` case needs,
 * collapsed into one call so each test stays under the repo's `max-statements` cap. */
const setupSyncedRef = async (homeDir: string): Promise<SyncedRefFixture> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ tags: DEFAULT_TAGS });
  const added = await addRefViaDescription(ctx, stdout, fixture.url);
  const home = resolveHome(ctx.env);
  return { added, ctx, fixture, home, stdout };
};

interface TwoRefsFixture {
  bad: AddedRef;
  badFixture: FixtureRepo;
  ctx: CliContext;
  good: AddedRef;
  home: RefsHome;
  stdout: string[];
}

/** Like `setupSyncedRef`, but seeds and adds TWO independent refs — needed by the partial-batch-
 * failure case, which breaks one of them (`bad`) after both are configured, and by the origin-
 * identity guard test, which repoints one checkout's origin at the OTHER ref's fixture. */
const setupTwoRefs = async (homeDir: string): Promise<TwoRefsFixture> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const goodFixture = await createFixtureRepo({ tags: DEFAULT_TAGS });
  const badFixture = await createFixtureRepo({ tags: DEFAULT_TAGS });
  const good = await addRefViaDescription(ctx, stdout, goodFixture.url);
  const bad = await addRefViaDescription(ctx, stdout, badFixture.url);
  const home = resolveHome(ctx.env);
  return { bad, badFixture, ctx, good, home, stdout };
};

interface SyncEnvelope {
  data: { results: { error?: string; key: string; status: string; warning?: string }[] };
  ok: boolean;
}

/** Runs `refs sync [...opts.refKeys] --json` (`--stale-only` optionally appended) and returns the
 * parsed envelope. Takes `opts.refKeys`/`opts.staleOnly` bundled (rather than two more positional
 * params) to stay under the repo's `max-params` cap, mirroring `add-guards-support.ts`'s own
 * `runAddDescriptionJson`. */
const runSyncJson = async (
  ctx: CliContext,
  stdout: string[],
  opts: { refKeys: readonly string[]; staleOnly?: boolean },
): Promise<SyncEnvelope> => {
  const args = ['node', 'refs', 'sync', ...opts.refKeys];
  if (opts.staleOnly === true) {
    args.push('--stale-only');
  }
  args.push('--json');
  await run(ctx, args);
  return parseLastEnvelope(stdout) as SyncEnvelope;
};

const TWO_RESULTS = 2;

interface PersistedSyncCheck {
  badKey: string;
  goodHeadShaBefore: string | undefined;
  goodKey: string;
  goodLastFetchedBefore: string | undefined;
  home: RefsHome;
}

/** Asserts the (f) partial-batch-failure shape: a still-`ok: true` envelope carrying exactly two
 * results, `goodKey`'s synced cleanly and `badKey`'s reported as `'failed'` — AND that the same
 * shape landed on disk: `goodKey`'s `last_fetched_at` advanced past `goodLastFetchedBefore` while
 * its `head_sha` stayed put (a `fresh` sync, not a fetch of anything new), and `badKey`'s
 * `last_error` was persisted with the exact message the in-memory result carried. Independently
 * verifies `sync-core.ts#syncOneKey`'s read-inside-lock write path under real parallelism, not
 * just the batch's in-memory return value. */
const expectGoodSyncedBadFailed = async (
  result: SyncEnvelope,
  check: PersistedSyncCheck,
): Promise<void> => {
  expect(result.ok).toBe(true);
  expect(result.data.results).toHaveLength(TWO_RESULTS);
  const goodResult = result.data.results.find((item) => item.key === check.goodKey);
  const badResult = result.data.results.find((item) => item.key === check.badKey);
  expect(goodResult?.status).toBe('fresh');
  expect(badResult?.status).toBe('failed');
  const state = await readState(check.home);
  expect(state.refs[check.goodKey]?.last_fetched_at).not.toBe(check.goodLastFetchedBefore);
  expect(state.refs[check.goodKey]?.head_sha).toBe(check.goodHeadShaBefore);
  expect(state.refs[check.badKey]?.last_error).toBe(badResult?.error);
};

interface OriginMismatchCheck {
  badKey: string;
  goodDest: string;
  goodKey: string;
  home: RefsHome;
}

/** Asserts the origin-identity-guard shape: `goodKey` (whose checkout's `origin` was repointed at
 * an unrelated repo) comes back `'failed'` with the mismatch naming its checkout path, `badKey`
 * (untouched sibling) still syncs cleanly — AND that the failure message landed on disk as
 * `goodKey`'s `last_error`, not just in the in-memory result. */
const expectOriginMismatchFailed = async (
  result: SyncEnvelope,
  check: OriginMismatchCheck,
): Promise<void> => {
  const goodResult = result.data.results.find((item) => item.key === check.goodKey);
  const badResult = result.data.results.find((item) => item.key === check.badKey);
  expect(goodResult?.status).toBe('failed');
  expect(goodResult?.error).toContain(check.goodDest);
  expect(badResult?.status).toBe('fresh');
  const state = await readState(check.home);
  expect(state.refs[check.goodKey]?.last_error).toBe(goodResult?.error);
};

export {
  addRefViaDescription,
  commitNewFileTo,
  expectGoodSyncedBadFailed,
  expectOriginMismatchFailed,
  gitFor,
  headShaOf,
  runSyncJson,
  setupSyncedRef,
  setupTwoRefs,
};
