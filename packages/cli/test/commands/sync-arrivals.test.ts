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
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { StructureReport } from '../../src/commands/drift-report.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { driftLines } from '../../src/commands/drift-report.ts';
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

/** Splits a printed command into argv the way a POSIX shell would, honouring single quotes.
 *
 * Small on purpose: the commands under test only ever use single quotes, which is what
 * `shellQuote` emits. Its job is to make the test run the string the tool PRINTED rather than one
 * the test rebuilt — a distinction that hid a real bug, since a hand-built argv passes a literal
 * `<ref>` placeholder straight through while a shell reads it as a redirection. */
type SplitState = { argv: string[]; current: string; quoted: boolean; started: boolean };

const step = (state: SplitState, char: string): SplitState => {
  if (char === "'") {
    return { ...state, quoted: !state.quoted, started: true };
  }
  if (char !== ' ' || state.quoted) {
    return { ...state, current: state.current + char };
  }
  const done = state.started || state.current.length > 0;
  return {
    argv: done ? [...state.argv, state.current] : state.argv,
    current: '',
    quoted: false,
    started: false,
  };
};

const splitCommand = (command: string): string[] => {
  const end = [...command].reduce<SplitState>((state, char) => step(state, char), {
    argv: [],
    current: '',
    quoted: false,
    started: false,
  });
  return end.started || end.current.length > 0 ? [...end.argv, end.current] : end.argv;
};

/** The `refs edit <key>` prefix of a repair command, which is where a `<ref>` placeholder used to
 * sit — a shell reads that as an input redirection, so the line could not run as printed. */
const COMMAND_PREFIX_LENGTH = 3;

/** Finds the printed repair line for one package, or throws — an absent line is a broken fixture,
 * not a branch worth asserting on. */
const repairLineFor = (report: StructureReport | undefined, key: string, name: string): string => {
  const line = driftLines(report ?? { status: 'ok' }, key).find((text) => text.includes(name));
  if (line === undefined) {
    throw new Error(`expected a drift line mentioning '${name}'`);
  }
  return line;
};

/** Runs the repair command a finding printed, VERBATIM — only the description placeholder is
 * filled in, which is the one part the finding deliberately leaves to the caller. */
const runPrintedRepair = async (
  ctx: CliContext,
  line: string,
  description: string,
): Promise<string[]> => {
  const marker = 'To register it: ';
  const command = line.slice(line.indexOf(marker) + marker.length);
  const argv = splitCommand(command).map((arg) => (arg === '<what it is>' ? description : arg));
  const { run } = await import('../../src/main.ts');
  // `refs …` as printed becomes `node refs …` as commander expects.
  await run(ctx, ['node', ...argv, '--json']);
  return argv;
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
          const result = await runSyncJson(ctx, stdout, { refKeys: [key] });

          // The line that sync printed, run as it stands. Rebuilding the argv by hand — which this
          // test used to do — passes a literal `<ref>` straight through without noticing that a
          // shell reads it as an input redirection.
          const printed = repairLineFor(result.data.results[0]?.structure, key, '@fixture/c');
          const argv = await runPrintedRepair(ctx, printed, 'The package that arrived.');
          // Nothing a shell would reinterpret, and the real key where `<ref>` used to sit.
          expect(argv).not.toContain('<ref>');
          expect(argv.slice(0, COMMAND_PREFIX_LENGTH)).toStrictEqual(['refs', 'edit', key]);

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
