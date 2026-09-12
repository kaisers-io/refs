import { addRefViaProposal, gitFor, runSyncJson } from '../helpers/sync-support.ts';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { readConfig, resolveHome, writeConfig } from '@kaisers-io/refs-core';
import { repairLineFor, resolveStatus, runPrintedRepair } from '../helpers/printed-command.ts';
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
  const added = await addRefViaProposal({ ctx, homeDir, source: fixture.url, stdout });
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

/** Splits a printed command into argv the way a POSIX shell would, honouring single quotes.
 *
 * Small on purpose: the commands under test only ever use single quotes, which is what
 * `shellQuote` emits. Its job is to make the test run the string the tool PRINTED rather than one
 * the test rebuilt — a distinction that hid a real bug, since a hand-built argv passes a literal
 * `<ref>` placeholder straight through while a shell reads it as a redirection. */
/** What has to be true after running the printed repair.
 *
 * "The next sync is quiet" proves nothing on its own: the arrival range was already consumed by
 * the sync that reported it, so the finding would be gone whether or not anything was registered.
 * These three are what actually establish the repair worked. */
const expectRegistered = async (
  ctx: CliContext,
  args: { command: string; key: string; stdout: string[] },
): Promise<void> => {
  // Nothing a shell would reinterpret, and the real key where `<ref>` used to sit.
  expect(args.command).not.toContain('<ref>');
  expect(args.command).toContain(`'${args.key}'`);

  const config = await readConfig(resolveHome(ctx.env));
  expect(config.refs[args.key]?.packages?.['@fixture/c']).toStrictEqual({
    description: 'The package that arrived.',
    path: 'packages/c',
  });

  await expect(resolveStatus(ctx, args.stdout, '@fixture/c')).resolves.toBe('verified');
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

// POSIX only: this one runs the printed command through `sh`, which Windows does not have. The
// finding it repairs, and everything else in this file, is platform-independent and covered above.
describe.skipIf(process.platform === 'win32')('refs sync: registering what arrived', () => {
  it(
    'silences the finding, with an entry that verifies like any other',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout, upstream } = await setupMonorepoRef(homeDir);
          await addUpstreamPackage(upstream, 'packages/c', '@fixture/c');
          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          // The line that sync printed, run as it stands. Rebuilding the argv by hand — which this
          // test used to do — passes a literal `<ref>` straight through without noticing that a
          // shell reads it as an input redirection.
          const printed = repairLineFor(result.data.results[0]?.structure, key, '@fixture/c');
          const command = await runPrintedRepair({
            description: 'The package that arrived.',
            env: ctx.env,
            line: printed,
          });
          await expectRegistered(ctx, { command, key, stdout });

          const after = await runSyncJson(ctx, stdout, { refKeys: [key] });
          expect(after.data.results[0]?.structure).toStrictEqual({ status: 'ok' });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: a package that only moved', () => {
  it(
    'stays silent, because the name is not new even though the directory is',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout, upstream } = await setupMonorepoRef(homeDir);
          await deregisterPackage(ctx, key, '@fixture/b');
          // Rename detection is off, so the move shows up as a manifest ADDED at
          // `packages/relocated` — which a path-based reading announces as an arrival, nagging
          // about a package the owner deliberately does not track every time upstream tidies up.
          await gitFor(upstream, ['mv', 'packages/b', 'packages/relocated']);
          await gitFor(upstream, ['commit', '-q', '-m', 'move package b']);

          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          expect(result.data.results[0]?.structure).toStrictEqual({ status: 'ok' });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: a package renamed in place', () => {
  it(
    'reports the new name, even though no manifest was added',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, key, stdout, upstream } = await setupMonorepoRef(homeDir);
          await deregisterPackage(ctx, key, '@fixture/b');
          // The manifest is MODIFIED, never added, so a path-based reading sees nothing at all.
          await writeFile(
            join(upstream, 'packages/b/package.json'),
            JSON.stringify({ name: '@fixture/renamed', private: true, version: '1.0.0' }),
          );
          await gitFor(upstream, ['add', '-A']);
          await gitFor(upstream, ['commit', '-q', '-m', 'rename package b']);

          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          expect(result.data.results[0]?.structure?.packages).toStrictEqual([
            { name: '@fixture/renamed', path: 'packages/b', status: 'unregistered' },
          ]);
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
          const added = await addRefViaProposal({ ctx, homeDir, source: fixture.url, stdout });
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
