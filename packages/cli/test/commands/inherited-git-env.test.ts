import {
  addRefViaDescription,
  gitFor,
  runSyncJson,
  setupSyncedRef,
} from '../helpers/sync-support.ts';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { readFile, writeFile } from 'node:fs/promises';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { join } from 'node:path';
import { resolveHome } from '@kaisers-io/refs-core';

// refs names a checkout by `cwd`, and git lets an inherited `GIT_DIR` / `GIT_WORK_TREE` /
// `GIT_INDEX_FILE` override that. git exports exactly these to every hook, so a `refs add` or
// `refs sync` run from a hook used to configure, reset and clean the CALLER's repository instead
// of refs' own checkout. These cases drive the CLI against real git with the variables pointing at
// a sentinel repository, and assert the sentinel's bytes, not refs' report.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const LOCATING_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'] as const;

type HookVars = Partial<Record<(typeof LOCATING_VARIABLES)[number], string>>;

type Sentinel = { dir: string; gitDir: string };

type SentinelBytes = { config: string; index: Buffer; readme: string; untracked: string };

/** A real repository with a tracked edit and an untracked file — what a hook's caller has. */
const dirtySentinel = async (): Promise<Sentinel> => {
  const { dir } = await createFixtureRepo();
  await writeFile(join(dir, 'README.md'), '# uncommitted edit\n');
  await writeFile(join(dir, 'untracked.txt'), 'not yet added\n');
  return { dir, gitDir: join(dir, '.git') };
};

const snapshot = async (sentinel: Sentinel): Promise<SentinelBytes> => ({
  config: await readFile(join(sentinel.gitDir, 'config'), 'utf8'),
  index: await readFile(join(sentinel.gitDir, 'index')),
  readme: await readFile(join(sentinel.dir, 'README.md'), 'utf8'),
  untracked: await readFile(join(sentinel.dir, 'untracked.txt'), 'utf8'),
});

const restore = (previous: readonly (readonly [string, string | undefined])[]): void => {
  for (const [name, value] of previous) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }
};

/** Runs `exercise` with the variables a hook would export set on THIS process, which is where
 * `SpawnRunner` takes its children's environment from — and restores them however it ends. */
const asIfFromAHook = async (vars: HookVars, exercise: () => Promise<unknown>): Promise<void> => {
  const previous = LOCATING_VARIABLES.map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, vars);
  try {
    await exercise();
  } finally {
    restore(previous);
  }
};

/** The managed marker every later guard reads back — on refs' checkout, where it belongs. Called
 * with the variables gone, so it asks the checkout and nothing else. */
const expectMarked = async (ctx: CliContext, dir: string): Promise<void> => {
  const hooksPath = await gitFor(dir, ['config', '--local', '--get', 'core.hooksPath']);
  expect(hooksPath).toBe(resolveHome(ctx.env).hooksDir);
};

const addUnderHook = async (homeDir: string): Promise<void> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const upstream = await createFixtureRepo();
  const sentinel = await dirtySentinel();
  const before = await snapshot(sentinel);
  // No `GIT_WORK_TREE`: with it, git refuses the clone outright, which is loud. `GIT_DIR` alone is
  // the silent case.
  const vars = { GIT_DIR: sentinel.gitDir, GIT_INDEX_FILE: join(sentinel.gitDir, 'index') };

  await asIfFromAHook(vars, () => addRefViaDescription(ctx, stdout, upstream.url));

  await expect(snapshot(sentinel)).resolves.toStrictEqual(before);
  const { key } = (parseLastEnvelope(stdout) as { data: { key: string } }).data;
  await expectMarked(ctx, join(resolveHome(ctx.env).sourcesDir, ...key.split('/')));
};

const syncUnderHook = async (homeDir: string): Promise<void> => {
  const { added, ctx, stdout } = await setupSyncedRef(homeDir);
  const sentinel = await dirtySentinel();
  const before = await snapshot(sentinel);
  const vars = {
    GIT_DIR: sentinel.gitDir,
    GIT_INDEX_FILE: join(sentinel.gitDir, 'index'),
    GIT_WORK_TREE: sentinel.dir,
  };

  await asIfFromAHook(vars, async () => {
    const envelope = await runSyncJson(ctx, stdout, { refKeys: [added.key] });
    expect(envelope.data.results.map((result) => result.status)).toStrictEqual(['fresh']);
  });

  await expect(snapshot(sentinel)).resolves.toStrictEqual(before);
  await expectMarked(ctx, added.dest);
};

describe('refs add with GIT_DIR inherited from a hook', SUITE_OPTS, () => {
  it('configures its own checkout and leaves the repository GIT_DIR names untouched', async () => {
    expect.hasAssertions();
    await withResetExitCode(() => withTempHome(addUnderHook));
  });
});

describe('refs sync with GIT_DIR and GIT_WORK_TREE inherited from a hook', SUITE_OPTS, () => {
  it('neither resets nor cleans the caller repository', async () => {
    expect.hasAssertions();
    await withResetExitCode(() => withTempHome(syncUnderHook));
  });
});
