import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { rm } from 'node:fs/promises';
import { run } from '../../src/main.ts';

// The guard for applying refs' hooks pin centrally (`src/pinned-runner.ts`): every git child of
// every refs command carries `-c core.hooksPath=<REFS_HOME>/hooks`. A git call site that bypassed
// the pin would let an inherited command-scope `core.hooksPath` run a hook the checkout tracks
// itself. This drives each command through the CLI against real git and records the argv each git
// child was actually given, so a new call site cannot ship without the pin.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SUCCESS = 0;

type GitCall = { args: readonly string[]; step: string };
type Drive = { calls: GitCall[]; ctx: CliContext; key: string; stdout: string[]; url: string };
// One command, or a filesystem change and a command, labelled by what it exercises.
type Step = [label: string, act: (drive: Drive) => Promise<void>];

/** Runs one refs command and fails the test unless it succeeded: a command that failed before it
 * reached git would pass the pin assertion vacuously. */
const refs = async (ctx: CliContext, args: readonly string[]): Promise<void> => {
  process.exitCode = undefined;
  await run(ctx, ['node', 'refs', ...args]);
  expect(process.exitCode ?? SUCCESS, `refs ${args.join(' ')}`).toBe(SUCCESS);
};

const dropCheckout = (drive: Drive): Promise<void> =>
  rm(checkoutPath(resolveHome(drive.ctx.env), zRefKey.parse(drive.key)), {
    force: true,
    recursive: true,
  });

/** Adds the fixture in one shot (it has no members, so only the ref needs a description) and keeps
 * the key refs derived, for every later step. */
const finalize = async (drive: Drive): Promise<void> => {
  await refs(drive.ctx, ['add', drive.url, '--description', 'A fixture repo.', '--json']);
  drive.key = (parseLastEnvelope(drive.stdout) as { data: { key: string } }).data.key;
};

/** Every refs command, in an order that leaves each one something to act on: proposing against a
 * fresh and then a reused checkout, cloning again from `sync` and from `resolve --sync-if-stale`
 * once the checkout is gone, and rewriting the remote from `edit`. */
const STEPS: readonly Step[] = [
  ['init', (drive) => initHome(drive.ctx)],
  ['add --dry-run', (drive) => refs(drive.ctx, ['add', drive.url, '--dry-run', '--json'])],
  ['add (reusing the checkout)', finalize],
  ['list', (drive) => refs(drive.ctx, ['list', '--json'])],
  ['show --tags', (drive) => refs(drive.ctx, ['show', drive.key, '--tags', '--json'])],
  ['tag', (drive) => refs(drive.ctx, ['tag', drive.key, '1.0.0', '--json'])],
  ['resolve', (drive) => refs(drive.ctx, ['resolve', drive.key, '--json'])],
  ['edit description', (drive) => refs(drive.ctx, ['edit', drive.key, 'description', 'Edited.'])],
  ['edit url', (drive) => refs(drive.ctx, ['edit', drive.key, 'url', `${drive.url}/`, '--json'])],
  ['sync', (drive) => refs(drive.ctx, ['sync', '--json'])],
  ['doctor', (drive) => refs(drive.ctx, ['doctor', '--json'])],
  ['migrate', (drive) => refs(drive.ctx, ['migrate', '--json'])],
  [
    'sync (re-clone)',
    async (drive) => {
      await dropCheckout(drive);
      await refs(drive.ctx, ['sync', '--json']);
    },
  ],
  [
    'resolve --sync-if-stale (re-clone)',
    async (drive) => {
      await dropCheckout(drive);
      await refs(drive.ctx, ['resolve', drive.key, '--sync-if-stale', '--json']);
    },
  ],
  ['remove', (drive) => refs(drive.ctx, ['remove', drive.key, '--json'])],
];

/** Points `ctx.runner` (real git) at a recorder that files every git argv under the current step,
 * read from `step.label` at call time. */
const recordInto = (ctx: CliContext, calls: GitCall[], step: { label: string }): void => {
  const inner = ctx.runner;
  ctx.runner = {
    run: (cmd, args, opts) => {
      calls.push(...(cmd === 'git' ? [{ args, step: step.label }] : []));
      return inner.run(cmd, args, opts);
    },
  };
};

const driveEveryCommand = async (homeDir: string): Promise<Drive> => {
  const { ctx, stdout } = realContextFor(homeDir);
  const { url } = await createFixtureRepo({ tags: ['v1.0.0'] });
  const drive: Drive = { calls: [], ctx, key: '', stdout, url };
  const step = { label: '' };
  recordInto(ctx, drive.calls, step);
  for (const [label, act] of STEPS) {
    step.label = label;
    // eslint-disable-next-line no-await-in-loop -- each command acts on the state the last left
    await act(drive);
  }
  return drive;
};

/** The git calls whose argv does not open with the pin for this home. */
const unpinned = (drive: Drive): GitCall[] => {
  const pin = ['-c', `core.hooksPath=${resolveHome(drive.ctx.env).hooksDir}`];
  return drive.calls.filter((call) => call.args[0] !== pin[0] || call.args[1] !== pin[1]);
};

// Each command known to spawn git, so a recorder that saw nothing cannot pass for one that saw
// only pinned calls.
const STEPS_THAT_RUN_GIT = new Set([
  'add --dry-run',
  'add (reusing the checkout)',
  'show --tags',
  'tag',
  'edit url',
  'sync',
  'doctor',
  'sync (re-clone)',
  'resolve --sync-if-stale (re-clone)',
]);

describe('the hooks pin', () => {
  it('is on every git call every refs command makes', SUITE_OPTS, async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const drive = await driveEveryCommand(homeDir);

        expect(unpinned(drive)).toStrictEqual([]);
        expect(new Set(drive.calls.map((call) => call.step))).toStrictEqual(STEPS_THAT_RUN_GIT);
      }),
    );
  });
});
