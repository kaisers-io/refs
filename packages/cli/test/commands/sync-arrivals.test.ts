import { addRefViaDescription, gitFor, runSyncJson } from '../helpers/sync-support.ts';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { readConfig, resolveHome, writeConfig } from '@kaisers-io/refs-core';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { join } from 'node:path';

// A package that arrived upstream, end to end through the real command against a real git remote.
//
// This is the case the drift probe could not see before: it verified the packages the config
// already had, so a package added upstream after `refs add` stayed invisible until someone
// happened to look. `sync` answers it from the range it just fetched — not from comparing a scan
// against the config, which cannot tell a new package from one the ref's owner never wanted.

type ArrivalFixture = {
  ctx: CliContext;
  key: string;
  stdout: string[];
  upstream: string;
};

const setupMonorepoRef = async (homeDir: string): Promise<ArrivalFixture> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ monorepo: true, monorepoAllDescribed: true });
  const added = await addRefViaDescription(ctx, stdout, fixture.url);
  return { ctx, key: added.key, stdout, upstream: fixture.dir };
};

/** Drops one package entry from a configured ref, leaving the checkout untouched — the state of
 * a user who deliberately does not track it. Written straight to the config because no command
 * removes a single package entry. */
const deregisterPackage = async (ctx: CliContext, key: string, name: string): Promise<void> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const entry = config.refs[key];
  const packages = { ...entry?.packages };
  if (entry === undefined || packages[name] === undefined) {
    throw new Error(`test setup: ref '${key}' does not register '${name}'`);
  }
  delete packages[name];
  await writeConfig(home, { ...config, refs: { ...config.refs, [key]: { ...entry, packages } } });
};

/** Registers a package on an existing ref through the real command — the repair the `unregistered`
 * finding names, run exactly as printed. */
const registerPackage = async (
  ctx: CliContext,
  args: { description: string; key: string; name: string; path: string },
): Promise<void> => {
  const { run } = await import('../../src/main.ts');
  await run(ctx, [
    'node',
    'refs',
    'edit',
    args.key,
    '--package',
    args.name,
    '--create',
    '--path',
    args.path,
    '--description',
    args.description,
    '--json',
  ]);
};

/** Adds a workspace member to the upstream fixture and commits it. */
const addUpstreamPackage = async (upstream: string, path: string, name: string): Promise<void> => {
  await mkdir(join(upstream, path), { recursive: true });
  await writeFile(
    join(upstream, path, 'package.json'),
    JSON.stringify({ name, private: true, version: '1.0.0' }),
  );
  await gitFor(upstream, ['add', '-A']);
  await gitFor(upstream, ['commit', '-q', '-m', `add ${name}`]);
};

describe('refs sync: a package that arrived upstream', () => {
  it(
    'reports it as unregistered, without failing the sync',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout, upstream } = await setupMonorepoRef(homeDir);
          await addUpstreamPackage(upstream, 'packages/c', '@fixture/c');

          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          const [item] = result.data.results;
          expect(item?.status).toBe('updated');
          expect(item?.structure).toStrictEqual({
            packages: [{ name: '@fixture/c', path: 'packages/c', status: 'unregistered' }],
            status: 'drift',
          });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: registering what arrived', () => {
  it(
    'silences the finding, with an entry that verifies like any other',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout, upstream } = await setupMonorepoRef(homeDir);
          await addUpstreamPackage(upstream, 'packages/c', '@fixture/c');
          await runSyncJson(ctx, stdout, { refKeys: [key] });

          // With a description the caller writes, never one copied out of the upstream manifest.
          await registerPackage(ctx, {
            description: 'The package that arrived.',
            key,
            name: '@fixture/c',
            path: 'packages/c',
          });

          const after = await runSyncJson(ctx, stdout, { refKeys: [key] });
          // Registered now, so the next sync has nothing to say about it — and the entry it wrote
          // verifies against the checkout like any other.
          expect(after.data.results[0]?.structure).toStrictEqual({ status: 'ok' });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: a package that was never registered and never arrived', () => {
  it(
    'stays silent about it on every sync',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ monorepo: true, monorepoAllDescribed: true });
          const added = await addRefViaDescription(ctx, stdout, fixture.url);
          await deregisterPackage(ctx, added.key, '@fixture/b');
          await gitFor(fixture.dir, ['commit', '-q', '--allow-empty', '-m', 'unrelated']);

          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          // A scan-against-config comparison would report `@fixture/b` here, on every single sync,
          // forever. The fetch range says nothing arrived, so neither does the probe.
          expect(result.data.results[0]?.structure).toStrictEqual({ status: 'ok' });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
