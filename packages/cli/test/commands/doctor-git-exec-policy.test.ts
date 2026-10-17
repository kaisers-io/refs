import { describe, expect, it } from 'vitest';
import {
  expectCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import type { DoctorTestHome } from '../helpers/doctor-support.ts';

// `git-exec-surfaces` under refs' own execution policy (#194). The listing `doctor` reads comes
// from a git process refs started, so it carries what refs switches off — fsmonitor on every git,
// configured hooks by event and by label from git 2.54 — and the check reports only what is left.

const NUL = '\0';
const SURFACE = 'git-exec-surfaces';

/** `git config --list -z --show-scope` output: `<scope>\0<key>\n<value>\0` per entry. */
const listing = (entries: readonly (readonly [string, string])[], scope = 'global'): string =>
  entries.map(([key, value]) => `${scope}${NUL}${key}\n${value}${NUL}`).join('');

const scriptConfig = (setup: DoctorTestHome, stdout: string, version: string): void => {
  setup.runner.expect('git --version', { stdout: version });
  setup.runner.expect('git config --list -z --show-scope', { stdout });
};

// refs' own policy (core's `git-exec-policy.ts`) reaches the listing as `command`-scope entries,
// last, because the listing comes from a git process refs started.
const POLICY: readonly (readonly [string, string])[] = [
  ['core.fsmonitor', ''],
  ['hook.post-checkout.enabled', 'false'],
  ['hook.post-index-change.enabled', 'false'],
  ['hook.pre-auto-gc.enabled', 'false'],
  ['hook.reference-transaction.enabled', 'false'],
];

// The per-label switch `SpawnRunner` adds on git 2.54 and later (core's `git-hook-labels.ts`).
const LABEL_SWITCH: readonly (readonly [string, string])[] = [['hook.evil.enabled', 'false']];

describe('refs doctor: what refs switches off for its own git invocations', () => {
  it('stays ok for an fsmonitor command refs overrides, because the last value wins', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(
          setup,
          listing([['core.fsmonitor', './monitor']]) + listing(POLICY, 'command'),
          'git version 2.43.0',
        );

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: configured hooks under refs policy', () => {
  it.each([
    ['git 2.54', 'git version 2.54.0', LABEL_SWITCH],
    ['git 2.55', 'git version 2.55.0', LABEL_SWITCH],
    ['a later git', 'git version 3.1.0', LABEL_SWITCH],
    ['a git with no configured hooks at all', 'git version 2.53.0', []],
  ])('stays ok for a configured hook refs disabled on %s', async (_label, version, labels) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(
          setup,
          listing([['hook.evil.command', './evil.sh']]) +
            listing([...POLICY, ...labels], 'command'),
          version,
        );

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { status: 'ok' });
      }),
    );
  });

  // On 2.55 too: a label named after an event turns refs' event switch into that label's switch.
  it.each([
    ['git 2.54 when no label switch reached it', 'git version 2.54.0'],
    ['git 2.55 when no label switch reached it', 'git version 2.55.0'],
    ['a git whose version could not be read', 'not a version line'],
  ])('warns for a configured hook on %s, saying why', async (_label, version) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(
          setup,
          listing([['hook.evil.command', './evil.sh']]) + listing(POLICY, 'command'),
          version,
        );

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { detailContains: 'nothing disabled it', status: 'warn' });
        expectCheck(envelope, SURFACE, { detailContains: 'hook.evil.command', status: 'warn' });
      }),
    );
  });
});

describe('refs doctor: configured hooks when git --version itself failed', () => {
  it('warns, because a version it could not read is no evidence the switch applies', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        setup.runner.expect('git --version', { exitCode: 1, stderr: 'broken' });
        setup.runner.expect('git config --list -z --show-scope', {
          stdout: listing([['hook.evil.command', './evil.sh']]) + listing(POLICY, 'command'),
        });

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { detailContains: 'hook.evil.command', status: 'warn' });
      }),
    );
  });
});

describe('refs doctor: filters under refs policy', () => {
  it('still warns for a filter, which refs leaves enabled', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(
          setup,
          listing([['filter.lfs.process', 'git-lfs filter-process']]) + listing(POLICY, 'command'),
          'git version 2.55.0',
        );

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { detailContains: 'stays enabled', status: 'warn' });
      }),
    );
  });
});
