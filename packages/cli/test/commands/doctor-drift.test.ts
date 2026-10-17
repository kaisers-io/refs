import { addPackage, writeJson } from '../helpers/workspace-fixture.ts';
import { checkoutPath, withLock, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectCheck,
  expectGitVersion,
  findCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import type { DoctorTestHome } from '../helpers/doctor-support.ts';
import type { RefsHome } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { refLockName } from '../../src/commands/add-source.ts';

// The `config-drift` doctor check. Unlike `sync`'s probe this one is deliberate — it inspects
// every existing checkout on request, which is what covers the refs a `--stale-only` or targeted
// sync never looks at. The checkout here is a fixture directory rather than a real clone: the
// probe only reads manifests, and `hooks-guard`/`dirty-checkouts` get their `git` output scripted
// through `FakeRunner`, exactly as in `doctor-checkouts.test.ts`.

const ALPHA_KEY = 'github.com/acme/alpha';
const ALPHA_URL = 'https://github.com/acme/alpha';

const refEntry = (
  packagePath: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'Alpha lib',
  packages: { '@acme/b': { description: 'Package B.', path: packagePath }, ...extra },
  url: ALPHA_URL,
});

/** Seeds the config plus a checkout that declares `packages/*` and holds only `@acme/a` — so a
 * ref configured for `@acme/b` at any path is drifted, and one configured for `@acme/a` is not. */
const seedCheckout = async (
  home: RefsHome,
  packagePath: string,
  extraPackages: Record<string, unknown> = {},
): Promise<string> => {
  await seedConfig(home, { [ALPHA_KEY]: refEntry(packagePath, extraPackages) });
  const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
  await markCheckoutPresent(dest, { hooksDir: home.hooksDir, url: ALPHA_URL });
  // Unnamed: these cases are about configured entries, and a named root would add an
  // `unregistered` finding of its own to every one of them.
  writeJson(join(dest, 'package.json'), { workspaces: ['packages/*'] });
  addPackage(dest, 'packages/a', { name: '@acme/a', version: '1.0.0' });
  return dest;
};

/** Queues the per-checkout `git` calls `hooks-guard` and `dirty-checkouts` make before
 * `config-drift` runs — `runStepsInOrder` runs the checks strictly in spec order. */
const expectCheckoutGit = (setup: DoctorTestHome, dest: string): void => {
  expectGitVersion(setup.runner);
  setup.runner.expect(
    'git config --local --get core.hooksPath',
    { stdout: setup.home.hooksDir },
    { cwd: dest },
  );
  setup.runner.expect('git status --porcelain', { stdout: '' }, { cwd: dest });
};

describe('refs doctor: config-drift', () => {
  it('warns that a configured package is no longer declared anywhere upstream', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        const dest = await seedCheckout(setup.home, 'packages/b');
        expectCheckoutGit(setup, dest);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, 'config-drift', {
          detailContains: "--package='@acme/b' --remove",
          status: 'warn',
        });
      }),
    );
  });

  it('reports ok when every configured package path still resolves', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        // Configures BOTH members: `doctor` discovers unregistered ones too (`{kind: 'all'}`),
        // so a checkout holding a member the config never had is `warn` by design, not `ok`.
        const dest = await seedCheckout(setup.home, 'packages/b', {
          '@acme/a': { description: 'Package A.', path: 'packages/a' },
        });
        addPackage(dest, 'packages/b', { name: '@acme/b', version: '1.0.0' });
        expectCheckoutGit(setup, dest);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, 'config-drift', { status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: config-drift under contention', () => {
  it('reports a ref whose lock is held as unknown instead of waiting for it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        const dest = await seedCheckout(setup.home, 'packages/b');
        expectCheckoutGit(setup, dest);

        // The lock is held for the whole `refs doctor` run — exactly what a concurrent `refs sync`
        // looks like. The check must say so rather than block on the default 10s timeout.
        const envelope = await withLock(setup.home, refLockName(zRefKey.parse(ALPHA_KEY)), () =>
          runDoctorJson(setup.ctx, setup.stdout),
        );

        expectCheck(envelope, 'config-drift', {
          // Not "a sync is in progress": `add`, `remove` and `resolve` take the same lock, and
          // nothing records which command holds it.
          detailContains: 'another refs process is holding this ref',
          status: 'warn',
        });
      }),
    );
  });
});

const MEMBER_COUNT = 12;
// The repository root, found by looking rather than by a pattern.
const ROOT_CANDIDATE = 1;
// The fixture's own registered package, which is `missing` in this layout.
const CONFIGURED_FINDING = 1;

/** A checkout declaring twelve unregistered members, with the ref's own registered package
 * missing — so the report carries both kinds of finding at once. */
const seedManyMembers = async (home: RefsHome): Promise<string> => {
  await seedConfig(home, { [ALPHA_KEY]: refEntry('packages/a') });
  const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
  await markCheckoutPresent(dest, { hooksDir: home.hooksDir, url: ALPHA_URL });
  writeJson(join(dest, 'package.json'), { workspaces: ['packages/*'] });
  addPackage(dest, 'packages/a', { name: '@acme/a', version: '1.0.0' });
  for (let index = 0; index < MEMBER_COUNT; index += 1) {
    addPackage(dest, `packages/m${index}`, { name: `@acme/m${index}`, version: '1.0.0' });
  }
  return dest;
};

describe('refs doctor: a repository with far more packages than the ref tracks', () => {
  it('reports the candidates as one grouped line, not one line each', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        const dest = await seedManyMembers(setup.home);
        expectCheckoutGit(setup, dest);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        // Grouped by the directory they sit in — structurally, never by what they look like.
        expectCheck(envelope, 'config-drift', {
          detailContains: `packages: ${MEMBER_COUNT + ROOT_CANDIDATE} unregistered package(s)`,
          status: 'warn',
        });
      }),
    );
  });

  it('carries every candidate in the JSON, uncapped', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        const dest = await seedManyMembers(setup.home);
        expectCheckoutGit(setup, dest);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        // A grouped line names a count. The caller that wants its members has to be able to get
        // them, or the group becomes a summary of something unreachable.
        const check = findCheck(envelope, 'config-drift');
        expect(check?.findings?.[0]?.packages).toHaveLength(
          MEMBER_COUNT + ROOT_CANDIDATE + CONFIGURED_FINDING,
        );
      }),
    );
  });
});

describe('refs doctor: a repository whose extra packages are only candidates', () => {
  it('stays healthy when the only findings are candidates', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        const dest = await seedOnlyCandidates(setup.home);
        expectCheckoutGit(setup, dest);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        // An unregistered package is not a defect in this configuration: nothing in it points
        // anywhere for that package, so there is nothing to be wrong. It is reported all the same.
        expectCheck(envelope, 'config-drift', {
          detailContains: 'every configured package path resolves',
          status: 'ok',
        });
      }),
    );
  });
});

/** The same checkout, with the ref's registered package where the configuration says it is: every
 * finding is then a discovery candidate and nothing is wrong. */
const seedOnlyCandidates = async (home: RefsHome): Promise<string> => {
  await seedConfig(home, {
    [ALPHA_KEY]: {
      default_branch: 'main',
      description: 'Alpha lib',
      packages: { '@acme/a': { description: 'Package A.', path: 'packages/a' } },
      url: ALPHA_URL,
    },
  });
  const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
  await markCheckoutPresent(dest, { hooksDir: home.hooksDir, url: ALPHA_URL });
  writeJson(join(dest, 'package.json'), { workspaces: ['packages/*'] });
  addPackage(dest, 'packages/a', { name: '@acme/a', version: '1.0.0' });
  for (let index = 0; index < MEMBER_COUNT; index += 1) {
    addPackage(dest, `packages/m${index}`, { name: `@acme/m${index}`, version: '1.0.0' });
  }
  return dest;
};
