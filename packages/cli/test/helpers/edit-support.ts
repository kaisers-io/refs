import { SpawnRunner, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import type { CliContext } from '../../src/context.ts';
import { createFixtureRepo } from './fixture-repo.ts';
import { seedConfig } from './ref-fixtures.ts';
import { testContext } from './context.ts';

// Shared fixture/assertion scaffolding for `edit.test.ts`/`edit-url.test.ts` — kept out of both
// purely to keep each test file under the repo's 300-line oxlint cap, mirroring
// `add-guards-support.ts`'s split from `add-support.ts`/`add-guards.test.ts`.

const REF_KEY = 'github.com/acme/widget';
const SETTINGS_SUFFIX_REF_KEY = 'github.com/acme/settings';
const PACKAGE_NAME = 'pkg';
const UNKNOWN_PACKAGE_NAME = 'nope';
const REF_ENTRY = {
  default_branch: 'main',
  description: 'Widget',
  packages: {
    [PACKAGE_NAME]: { description: 'Widget package', path: 'packages/pkg' },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/widget',
};

// A ref whose key ends in the literal segment 'settings' — reachable by that bare suffix, yet
// `refs edit settings ...` can never actually reach it (see `edit.ts`'s reserved-word dispatch).
// Used only by Finding 2's silent-collision-warning case.
const SETTINGS_SUFFIX_REF_ENTRY = {
  default_branch: 'main',
  description: 'A ref literally named settings',
  tag_format: 'v{version}',
  url: 'https://github.com/acme/settings',
};

const CLONE_SUCCESS_EXIT_CODE = 0;

type EditEnvelope = {
  data?: { field: string; key: string; new: unknown; old: unknown };
  error?: { code: string; message: string };
  ok: boolean;
  warnings?: string[];
};

const parseSoleEnvelope = (stdout: readonly string[]): EditEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as EditEnvelope;
};

type EditFixture = {
  ctx: CliContext;
  stderr: string[];
  stdout: string[];
};

/** Seeds a fresh temp home with `REF_KEY` (default settings, one registered package) — the common
 * setup every non-git `refs edit` case needs. */
const setupEditFixture = async (homeDir: string): Promise<EditFixture> => {
  const { ctx, stderr, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedConfig(home, { [REF_KEY]: REF_ENTRY });
  return { ctx, stderr, stdout };
};

/** Like `setupEditFixture`, but also registers `SETTINGS_SUFFIX_REF_KEY` — a ref reachable by the
 * bare suffix 'settings' — for Finding 2's silent-collision-warning case. */
const setupEditFixtureWithSettingsSuffixRef = async (homeDir: string): Promise<EditFixture> => {
  const { ctx, stderr, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedConfig(home, {
    [REF_KEY]: REF_ENTRY,
    [SETTINGS_SUFFIX_REF_KEY]: SETTINGS_SUFFIX_REF_ENTRY,
  });
  return { ctx, stderr, stdout };
};

/** Like `setupEditFixture`, but also clones a real fixture repo directly into `REF_KEY`'s checkout
 * path and swaps in a real `SpawnRunner` — for the `url` edit case that must actually rewrite the
 * checkout's `origin` remote. */
const setupEditFixtureWithCheckout = async (homeDir: string): Promise<EditFixture> => {
  const { ctx, stderr, stdout } = await setupEditFixture(homeDir);
  ctx.runner = new SpawnRunner();
  const home = resolveHome(ctx.env);
  const fixture = await createFixtureRepo();
  const dest = checkoutPath(home, zRefKey.parse(REF_KEY));
  const result = await ctx.runner.run('git', ['clone', '-q', fixture.dir, dest]);
  if (result.exitCode !== CLONE_SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git clone failed: ${result.stderr}`);
  }
  return { ctx, stderr, stdout };
};

export {
  PACKAGE_NAME,
  REF_ENTRY,
  REF_KEY,
  SETTINGS_SUFFIX_REF_KEY,
  UNKNOWN_PACKAGE_NAME,
  parseSoleEnvelope,
  setupEditFixture,
  setupEditFixtureWithCheckout,
  setupEditFixtureWithSettingsSuffixRef,
};
export type { EditEnvelope };
