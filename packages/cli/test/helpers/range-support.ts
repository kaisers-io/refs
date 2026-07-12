import { SpawnRunner, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { buildProgram, runProgram } from '../../src/main.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CliContext } from '../../src/context.ts';
import type { RangeData } from '../../src/commands/range.ts';
import { createFixtureRepo } from './fixture-repo.ts';
import { join } from 'node:path';
import { seedConfig } from './ref-fixtures.ts';
import { testContext } from './context.ts';

// Shared scaffolding for `range.test.ts` — kept separate (mirroring `add-support.ts`) so the test
// file itself stays under the repo's per-file line and import caps. Builds a real two-tag git
// fixture (`v1.0.0`/`pkg@1.0.0` on the initial commit, then a CHANGELOG commit and a
// `packages/pkg` commit, then `v2.0.0`/`pkg@2.0.0`), clones it into a seeded ref's checkout, and
// drives the command through the registry-built program via `runProgram` (`range` is wired into
// the command registry through `registrars-extra.ts`, so `buildProgram` already carries it),
// preserving the real `wrapAction`/exit-code behaviour.

const REF_KEY = 'github.com/acme/widget';
const PACKAGE_NAME = 'pkg';
const UNKNOWN_PACKAGE_NAME = 'nope';
const REF_ENTRY = {
  default_branch: 'main',
  description: 'Widget',
  packages: {
    [PACKAGE_NAME]: {
      description: 'Widget package',
      path: `packages/${PACKAGE_NAME}`,
      tag_format: 'pkg@{version}',
    },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/widget',
};

const FIXTURE_CHANGELOG = [
  '# Changelog',
  '',
  '## 2.0.0',
  '',
  '- Added feature X',
  '',
  '## 1.0.0',
  '',
  '- Initial release',
  '',
].join('\n');

const SUCCESS_EXIT_CODE = 0;
// Test-setup-only `SpawnRunner`, mirroring `tag.test.ts`'s own `setupRunner`.
const setupRunner = new SpawnRunner();

const git = async (dir: string, args: readonly string[]): Promise<void> => {
  const result = await setupRunner.run('git', args, { cwd: dir });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git ${args.join(' ')} failed: ${result.stderr}`);
  }
};

const commitAll = async (dir: string, message: string): Promise<void> => {
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', message]);
};

interface RangeFixtureOpts {
  // `false` skips the CHANGELOG commit entirely — the "changelog: null" case; the range then
  // spans exactly one commit instead of two.
  withChangelog?: boolean;
}

/** Builds the two-tag fixture described in the file comment; between the old and new tags sit
 * an `add changelog` commit (unless `withChangelog: false`) and a `pkg change` commit touching
 * only `packages/pkg/`. */
const buildRangeFixture = async (opts: RangeFixtureOpts): Promise<string> => {
  const fixture = await createFixtureRepo({ tags: ['pkg@1.0.0', 'v1.0.0'] });
  if (opts.withChangelog !== false) {
    await writeFile(join(fixture.dir, 'CHANGELOG.md'), FIXTURE_CHANGELOG);
    await commitAll(fixture.dir, 'add changelog');
  }
  await mkdir(join(fixture.dir, 'packages', PACKAGE_NAME), { recursive: true });
  await writeFile(join(fixture.dir, 'packages', PACKAGE_NAME, 'index.txt'), 'pkg v2\n');
  await commitAll(fixture.dir, 'pkg change');
  await git(fixture.dir, ['tag', 'v2.0.0']);
  await git(fixture.dir, ['tag', 'pkg@2.0.0']);
  return fixture.dir;
};

interface RangeTestFixture {
  ctx: CliContext;
  stdout: string[];
}

/** Clones the fixture repo directly into `dest` — a real, unmanaged checkout with real tags,
 * mirroring `tag.test.ts`'s `cloneFixtureInto`. */
const cloneFixtureInto = async (fixtureDir: string, dest: string): Promise<void> => {
  const result = await setupRunner.run('git', ['clone', '-q', fixtureDir, dest]);
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git clone failed: ${result.stderr}`);
  }
};

/** Bootstraps a fresh temp home, seeds `REF_KEY` (ref-level `v{version}` format plus the `pkg`
 * package with its own `pkg@{version}` format and `packages/pkg` path), and clones the range
 * fixture into its checkout. */
const setupRangeFixture = async (
  homeDir: string,
  opts: RangeFixtureOpts = {},
): Promise<RangeTestFixture> => {
  const { ctx, stdout } = testContext();
  ctx.runner = new SpawnRunner();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  const fixtureDir = await buildRangeFixture(opts);
  await cloneFixtureInto(fixtureDir, checkoutPath(home, zRefKey.parse(REF_KEY)));
  await seedConfig(home, { [REF_KEY]: REF_ENTRY });
  return { ctx, stdout };
};

// A ref whose tag_format renders LEADING-DASH tags ('-v1.0.0') — git accepts such refs
// (`refs/tags/-v1.0.0` is valid), so the range queries must never let them be parsed as
// Options. `git tag` itself refuses the name; `git update-ref` creates it.
const DASH_REF_KEY = 'github.com/acme/dashes';
const DASH_REF_ENTRY = {
  default_branch: 'main',
  description: 'Dashes',
  tag_format: '-v{version}',
  url: 'https://github.com/acme/dashes',
};

/** Builds a one-commit-range fixture whose two tags both start with `-`: `-v1.0.0` on the
 * initial commit, one `dash change` commit, then `-v2.0.0`. */
const buildDashTagFixture = async (): Promise<string> => {
  const fixture = await createFixtureRepo();
  await git(fixture.dir, ['update-ref', 'refs/tags/-v1.0.0', 'HEAD']);
  await writeFile(join(fixture.dir, 'dash.txt'), 'dash v2\n');
  await commitAll(fixture.dir, 'dash change');
  await git(fixture.dir, ['update-ref', 'refs/tags/-v2.0.0', 'HEAD']);
  return fixture.dir;
};

/** Bootstraps a fresh temp home and seeds `DASH_REF_KEY` (tag_format `-v{version}`) with the
 * dash-tag fixture cloned into its checkout. */
const setupDashRangeFixture = async (homeDir: string): Promise<RangeTestFixture> => {
  const { ctx, stdout } = testContext();
  ctx.runner = new SpawnRunner();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  const fixtureDir = await buildDashTagFixture();
  await cloneFixtureInto(fixtureDir, checkoutPath(home, zRefKey.parse(DASH_REF_KEY)));
  await seedConfig(home, { [DASH_REF_KEY]: DASH_REF_ENTRY });
  return { ctx, stdout };
};

/** Seeds `REF_KEY` WITHOUT cloning anything into its checkout path — the "missing checkout"
 * case, mirroring `tag.test.ts`'s `setupTagFixtureNoCheckout`. */
const setupRangeFixtureNoCheckout = async (homeDir: string): Promise<RangeTestFixture> => {
  const { ctx, stdout } = testContext();
  ctx.runner = new SpawnRunner();
  ctx.env['REFS_HOME'] = homeDir;
  await seedConfig(resolveHome(ctx.env), { [REF_KEY]: REF_ENTRY });
  return { ctx, stdout };
};

/** Runs `refs range <args...>` through the registry-built program — `range` is registered via
 * `registrars-extra.ts`, so no manual wiring is needed here. */
const runRangeCli = async (ctx: CliContext, args: readonly string[]): Promise<void> => {
  const program = buildProgram(ctx);
  await runProgram(ctx, program, ['node', 'refs', 'range', ...args]);
};

interface RangeEnvelope {
  data?: RangeData;
  error?: { code: string; message: string };
  ok: boolean;
}

const parseSoleEnvelope = (stdout: readonly string[]): RangeEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as RangeEnvelope;
};

export {
  DASH_REF_KEY,
  PACKAGE_NAME,
  parseSoleEnvelope,
  REF_KEY,
  runRangeCli,
  setupDashRangeFixture,
  setupRangeFixture,
  setupRangeFixtureNoCheckout,
  UNKNOWN_PACKAGE_NAME,
};
export type { RangeEnvelope };
