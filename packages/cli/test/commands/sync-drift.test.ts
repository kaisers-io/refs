import { addRefViaDescription, gitFor, runSyncJson } from '../helpers/sync-support.ts';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';

// `refs sync`'s drift probe, end to end through the real command against a real git remote: the
// upstream monorepo drops or renames a package directory, and the sync that pulls that change in
// has to say so — under the lock it already holds, without turning a clean sync into a failure.

type DriftFixture = {
  ctx: CliContext;
  key: string;
  stdout: string[];
  upstream: string;
};

/** A real `file://` monorepo remote with `@fixture/a` and `@fixture/b`, added as a configured ref
 * (both packages described, so `refs add`'s one-shot flow registers them both). */
const setupMonorepoRef = async (homeDir: string): Promise<DriftFixture> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ monorepo: true, monorepoAllDescribed: true });
  const added = await addRefViaDescription(ctx, stdout, fixture.url);
  return { ctx, key: added.key, stdout, upstream: fixture.dir };
};

describe('refs sync: config drift', () => {
  it(
    'reports a package the upstream repo deleted as missing, without failing the sync',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout, upstream } = await setupMonorepoRef(homeDir);
          await gitFor(upstream, ['rm', '-r', '-q', 'packages/b']);
          await gitFor(upstream, ['commit', '-q', '-m', 'drop package b']);

          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          const [item] = result.data.results;
          expect(item?.status).toBe('updated');
          expect(item?.structure).toStrictEqual({
            packages: [{ configured_path: 'packages/b', name: '@fixture/b', status: 'missing' }],
            status: 'drift',
          });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: config drift, relocation', () => {
  it(
    'reports a package the upstream repo moved as relocated, naming the new path',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout, upstream } = await setupMonorepoRef(homeDir);
          await gitFor(upstream, ['mv', 'packages/b', 'packages/renamed']);
          await gitFor(upstream, ['commit', '-q', '-m', 'move package b']);

          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          const [item] = result.data.results;
          expect(item?.structure?.status).toBe('drift');
          expect(item?.structure?.packages?.[0]).toStrictEqual({
            configured_path: 'packages/b',
            name: '@fixture/b',
            path: 'packages/renamed',
            status: 'relocated',
          });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: no drift', () => {
  it(
    'stays silent about a checkout whose configured packages all still resolve',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout } = await setupMonorepoRef(homeDir);

          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          expect(result.data.results[0]?.structure).toStrictEqual({ status: 'ok' });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
