import {
  GIT_VERSION_STDOUT,
  expectCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { describe, expect, it } from 'vitest';
import type { DoctorTestHome } from '../helpers/doctor-support.ts';

// What `core.hooksPath` does NOT cover.
//
// It governs hooks-DIRECTORY discovery, which is the boundary refs pins and, within its own terms,
// keeps. Other mechanisms do not route through it. Measured on git 2.54 against a real clone with
// `core.hooksPath` correctly set to a refs-owned directory, both running the CHECKOUT's own script:
//
//   [hook "x"] event = post-checkout ; command = ./evil.sh     -> ran on `refs add` and `refs sync`
//   [filter "y"] smudge = ./filter.sh  (selected by .gitattributes) -> ran on the `sync` checkout
//
// The check reports PRESENCE, never safety. An earlier version reported only commands that looked
// repository-relative; `/bin/sh ./evil.sh` has an absolute first token and was measured to run the
// checkout's script anyway, and `[hook "company.checkout"]` — a dotted subsection, which git
// permits — was measured to run while missing the key pattern entirely.

const NUL = '\0';
const SURFACE = 'git-exec-surfaces';

/** `git config --list -z --show-scope` output: `<scope>\0<key>\n<value>\0` per entry. */
const listing = (entries: readonly (readonly [string, string])[], scope = 'global'): string =>
  entries.map(([key, value]) => `${scope}${NUL}${key}\n${value}${NUL}`).join('');

const scriptConfig = (setup: DoctorTestHome, stdout: string): void => {
  setup.runner.expect('git --version', { stdout: GIT_VERSION_STDOUT });
  setup.runner.expect('git config --list -z --show-scope', { stdout });
};

describe('refs doctor: git configured to run something of its own', () => {
  it.each([
    ['a configured hook', 'hook.evil.command', './evil.sh'],
    ['a hook with a dotted label', 'hook.company.checkout.command', './evil.sh'],
    ['a hook behind an absolute interpreter', 'hook.evil.command', '/bin/sh ./evil.sh'],
    ['a smudge filter', 'filter.evil.smudge', 'anything'],
    ['a clean filter', 'filter.evil.clean', 'anything'],
    ['a long-running filter', 'filter.evil.process', 'anything'],
    ['an fsmonitor command', 'core.fsmonitor', './monitor'],
  ])('warns, naming the key: %s', async (_label, key, value) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(setup, listing([[key, value]]));

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { detailContains: key, status: 'warn' });
      }),
    );
  });
});

describe('refs doctor: git configuration that runs nothing', () => {
  it.each([
    ['an fsmonitor boolean', 'core.fsmonitor', 'true'],
    ['an fsmonitor turned off', 'core.fsmonitor', 'false'],
  ])('stays ok: %s', async (_label, key, value) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(setup, listing([[key, value]]));

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { status: 'ok' });
      }),
    );
  });

  it('stays ok for a hook git will not run', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(
          setup,
          listing([
            ['hook.evil.command', './evil.sh'],
            ['hook.evil.enabled', 'false'],
          ]),
        );

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: a checkout own local config', () => {
  it('is ignored, which is where refs pins the hooks path', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(setup, listing([['hook.evil.command', './evil.sh']], 'local'));

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: an ordinary git configuration', () => {
  it('is ok, and says what it established', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(
          setup,
          listing([
            ['user.name', 'A Person'],
            ['credential.helper', 'osxkeychain'],
            ['core.excludesfile', '~/.gitignore'],
          ]),
        );

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, {
          detailContains: 'no configured hook, filter or fsmonitor command',
          status: 'ok',
        });
      }),
    );
  });
});

describe('refs doctor: a git configuration it could not read whole', () => {
  it('warns when the command failed', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        setup.runner.expect('git --version', { stdout: GIT_VERSION_STDOUT });
        setup.runner.expect('git config --list -z --show-scope', { exitCode: 1 });

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        // A check that could not look must not answer `ok`.
        expectCheck(envelope, SURFACE, { status: 'warn' });
      }),
    );
  });

  it('warns when the listing was cut at the stream cap', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        setup.runner.expect('git --version', { stdout: GIT_VERSION_STDOUT });
        // A cut listing keeps the FIRST entries, so it reads as a complete, shorter configuration
        // — and the entry that matters may be past the cut.
        setup.runner.expect('git config --list -z --show-scope', {
          stdout: listing([['user.name', 'A Person']]),
          stdoutTruncated: true,
        });

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { status: 'warn' });
      }),
    );
  });
});

describe('refs doctor: a config value carrying a newline', () => {
  it('is parsed by NUL records, which is what -z is for', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        scriptConfig(
          setup,
          listing([
            ['alias.multi', 'log\n--oneline'],
            ['hook.evil.command', './evil.sh'],
          ]),
        );

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, SURFACE, { detailContains: 'hook.evil.command', status: 'warn' });
      }),
    );
  });
});
