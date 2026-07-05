import { EXIT, TIMEOUT_EXIT_CODE } from '@kaisers-io/refs-core';
import {
  buildSshConfig,
  buildSshRefEntry,
  expectCheck,
  expectGitVersion,
  findCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { describe, expect, it } from 'vitest';
import { checkSshAuth } from '../../src/commands/doctor-checks-ssh.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// `ssh-auth` only appears in the check list when a configured ref uses an ssh transport url — this
// suite covers the ok/fail probe outcomes via `FakeRunner` (real ssh auth against a live host has
// no place in a unit suite). Split out of `doctor.test.ts` purely to keep that file under the
// repo's 300-line oxlint cap.

const SSH_KEY = 'github.com/acme/ssh-repo';
const SSH_HOST = 'github.com';
const SSH_PROBE_PREFIX = 'ssh -o ConnectTimeout=5 -o BatchMode=yes -T git@github.com';

describe('refs doctor: ssh-auth ok', () => {
  it('reports ok when ssh -T succeeds without a "Permission denied" stderr', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [SSH_KEY]: buildSshRefEntry(SSH_HOST) });
        expectGitVersion(runner);
        runner.expect(SSH_PROBE_PREFIX, {
          exitCode: 1,
          stderr:
            "Hi acme! You've successfully authenticated, but GitHub does not provide shell access.",
        });

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'ssh-auth', { detailContains: SSH_HOST, status: 'ok' });
        expect(process.exitCode).toBeUndefined();
      }),
    );
  });
});

describe('refs doctor: ssh-auth permission denied', () => {
  it('reports fail when stderr contains "Permission denied", and exits 1', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [SSH_KEY]: buildSshRefEntry(SSH_HOST) });
        expectGitVersion(runner);
        runner.expect(SSH_PROBE_PREFIX, {
          exitCode: 255,
          stderr: 'git@github.com: Permission denied (publickey).',
        });

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'ssh-auth', { detailContains: SSH_HOST, status: 'fail' });
        expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      }),
    );
  });
});

describe('refs doctor: ssh-auth omitted', () => {
  it('is absent from the check list when no configured ref uses an ssh url', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, {
          'github.com/acme/https-only': {
            default_branch: 'main',
            description: 'Https lib',
            tag_format: 'v{version}',
            url: 'https://github.com/acme/https-only',
          },
        });
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expect(findCheck(envelope, 'ssh-auth')).toBeUndefined();
      }),
    );
  });
});

const SHORT_TEST_TIMEOUT_MS = 20;

// Exercises the same normalized shape `SpawnRunner` produces when its own `timeoutMs` kills the
// child (see `core/test/proc/runner.test.ts` for the real-process proof): `exitCode` set to
// `TIMEOUT_EXIT_CODE` AND `timedOut: true` — the latter is the actual signal `checkSshAuth` branches
// on (see `doctor-ssh-timeout.test.ts`'s "genuine exit 124" suite for why `exitCode` alone can't be
// trusted).
describe('refs doctor: ssh-auth probe timeout', () => {
  it('fails with a timeout detail when the runner reports a killed-by-timeout probe', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [SSH_KEY]: buildSshRefEntry(SSH_HOST) });
    runner.expect(SSH_PROBE_PREFIX, {
      exitCode: TIMEOUT_EXIT_CODE,
      stderr: 'refs: command timed out after 20ms',
      timedOut: true,
    });

    const result = await checkSshAuth(ctx, config, { timeoutMs: SHORT_TEST_TIMEOUT_MS });

    expect(result?.status).toBe('fail');
    expect(result?.detail).toContain('ssh probe timed out after');
    expect(result?.detail).toContain(SSH_HOST);
  });
});

const CONNECTION_WARN_CASES = [
  { detail: 'Could not resolve hostname github.com: nodename nor servname provided' },
  { detail: 'ssh: connect to host github.com port 22: Connection refused' },
  { detail: 'Host key verification failed.' },
  { detail: 'ssh: connect to host github.com port 22: Operation timed out' },
] as const;

describe('refs doctor: ssh-auth connection-level failures', () => {
  it.each(CONNECTION_WARN_CASES)('reports warn (not fail) for "$detail"', async ({ detail }) => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [SSH_KEY]: buildSshRefEntry(SSH_HOST) });
    runner.expect(SSH_PROBE_PREFIX, { exitCode: 255, stderr: detail });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('warn');
    expect(result?.detail).toContain(SSH_HOST);
    expect(result?.detail).toContain(detail);
  });

  it('still reports fail for "Permission denied", not warn', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [SSH_KEY]: buildSshRefEntry(SSH_HOST) });
    runner.expect(SSH_PROBE_PREFIX, {
      exitCode: 255,
      stderr: 'git@github.com: Permission denied (publickey).',
    });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('fail');
  });

  it('still reports ok for the GitHub-style "successfully authenticated" exit-1 success', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [SSH_KEY]: buildSshRefEntry(SSH_HOST) });
    runner.expect(SSH_PROBE_PREFIX, {
      exitCode: 1,
      stderr:
        "Hi acme! You've successfully authenticated, but GitHub does not provide shell access.",
    });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('ok');
  });
});

const USER_HOST = 'example.com';
const USER_KEY = 'example.com/acme/deploy-repo';
const USER_PROBE_PREFIX = 'ssh -o ConnectTimeout=5 -o BatchMode=yes -T deploy@example.com';
const USER_REF_ENTRY = {
  default_branch: 'main',
  description: 'Ssh deploy-user lib',
  tag_format: 'v{version}',
  url: 'ssh://deploy@example.com/acme/deploy-repo.git',
};

describe('refs doctor: ssh-auth honors a non-default ssh:// username', () => {
  it('probes deploy@host rather than hardcoding git@host', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [USER_KEY]: USER_REF_ENTRY });
    runner.expect(USER_PROBE_PREFIX, { exitCode: 1, stdout: '' });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('ok');
    const [call] = runner.calls;
    expect(call?.args).toStrictEqual(expect.arrayContaining(['-T', `deploy@${USER_HOST}`]));
  });
});

const SHARED_HOST_DEPLOY_KEY = 'github.com/acme/deploy-repo';
const SHARED_HOST_DEPLOY_ENTRY = {
  default_branch: 'main',
  description: 'Ssh deploy-user lib on a shared host',
  tag_format: 'v{version}',
  url: 'ssh://deploy@github.com/acme/deploy-repo.git',
};
const DEPLOY_PROBE_PREFIX = 'ssh -o ConnectTimeout=5 -o BatchMode=yes -T deploy@github.com';
const LAST_ARG_OFFSET = -1;

describe('refs doctor: ssh-auth dedupes by full target identity, not host alone', () => {
  it('probes a shared host once per distinct user, labeling the non-git one user@host', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({
      [SHARED_HOST_DEPLOY_KEY]: SHARED_HOST_DEPLOY_ENTRY,
      [SSH_KEY]: buildSshRefEntry(SSH_HOST),
    });
    // Targets are probed in sorted display order: `deploy@github.com` before `github.com`.
    runner.expect(DEPLOY_PROBE_PREFIX, { exitCode: 1, stdout: '' });
    runner.expect(SSH_PROBE_PREFIX, { exitCode: 1, stdout: '' });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('ok');
    expect(result?.detail).toContain(`deploy@${SSH_HOST}`);
    // Exactly two probes, one per distinct user — asserted via each call's `ssh` destination
    // (its last argument), in sorted display order.
    const destinations = runner.calls.map((call) => call.args.at(LAST_ARG_OFFSET));
    expect(destinations).toStrictEqual([`deploy@${SSH_HOST}`, `git@${SSH_HOST}`]);
  });
});

const PORT_HOST = 'example.com';
const PORT_KEY = 'example.com_2222/acme/port-repo';
const PORT_PROBE_PREFIX = 'ssh -o ConnectTimeout=5 -o BatchMode=yes -p 2222 -T git@example.com';
const PORT_REF_ENTRY = {
  default_branch: 'main',
  description: 'Ssh custom-port lib',
  tag_format: 'v{version}',
  url: 'ssh://git@example.com:2222/acme/port-repo.git',
};

describe('refs doctor: ssh-auth carries a non-default ssh:// port', () => {
  it('passes -p <port> to the probe and labels the check by host:port', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [PORT_KEY]: PORT_REF_ENTRY });
    runner.expect(PORT_PROBE_PREFIX, { exitCode: 1, stdout: '' });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('ok');
    expect(result?.detail).toContain(`${PORT_HOST}:2222`);
    const [call] = runner.calls;
    expect(call?.args).toStrictEqual(expect.arrayContaining(['-p', '2222']));
  });
});
