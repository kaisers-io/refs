import { addPackage, writeJson } from '../helpers/workspace-fixture.ts';
import { checkoutPath, withLock, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectCheck,
  expectGitVersion,
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

const refEntry = (packagePath: string): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'Alpha lib',
  packages: { '@acme/b': { description: 'Package B.', path: packagePath } },
  url: ALPHA_URL,
});

/** Seeds the config plus a checkout that declares `packages/*` and holds only `@acme/a` — so a
 * ref configured for `@acme/b` at any path is drifted, and one configured for `@acme/a` is not. */
const seedCheckout = async (home: RefsHome, packagePath: string): Promise<string> => {
  await seedConfig(home, { [ALPHA_KEY]: refEntry(packagePath) });
  const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
  await markCheckoutPresent(dest, { hooksDir: home.hooksDir, url: ALPHA_URL });
  writeJson(join(dest, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
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
          detailContains: 'remove the entry',
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
        const dest = await seedCheckout(setup.home, 'packages/b');
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
