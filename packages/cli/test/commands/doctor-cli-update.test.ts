import { describe, expect, it } from 'vitest';
import {
  expectGitVersion,
  findCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { EXIT } from '@kaisers-io/refs-core';
import type { Fetcher } from '@kaisers-io/refs-core';

// The `cli-update` check. It is one of only two places refs contacts the registry, and the only one
// that reports the answer as a check — so what matters here is that it never turns a healthy
// machine into a failing one, and that it stays quiet about anything it cannot order.
//
// `testContext`'s default fetcher rejects, so nothing below reaches the network unless it stubs one.
const CHECK_NAME = 'cli-update';

const respondingWith =
  (version: string): Fetcher =>
  () =>
    Promise.resolve({ json: () => Promise.resolve({ version }), status: 200 });

describe('refs doctor: cli-update', () => {
  it('warns, with the update command, when npm publishes a newer version', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        ctx.cliVersion = '0.8.3';
        ctx.fetcher = respondingWith('0.9.0');

        const checks = await runDoctorJson(ctx, stdout);

        const check = findCheck(checks, CHECK_NAME);
        expect(check?.status).toBe('warn');
        expect(check?.detail).toMatch(/refs 0\.9\.0 is available \(this is 0\.8\.3\)/u);
        expect(check?.detail).toMatch(/npm i -g @kaisers-io\/refs@latest/u);
      }),
    );
  });

  it('reports ok when this CLI is the latest release', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        ctx.cliVersion = '0.9.0';
        ctx.fetcher = respondingWith('0.9.0');

        const checks = await runDoctorJson(ctx, stdout);

        expect(findCheck(checks, CHECK_NAME)?.status).toBe('ok');
      }),
    );
  });
});

describe('refs doctor: cli-update when it cannot ask', () => {
  it('warns rather than fails when the registry cannot be reached', async () => {
    // A `fail` would make `refs doctor` exit non-zero, turning an unreachable network into a broken
    // installation. `runStepSafely` would do exactly that if the check let a rejection escape.
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        ctx.fetcher = () => Promise.reject(new Error('offline'));

        const checks = await runDoctorJson(ctx, stdout);

        expect(findCheck(checks, CHECK_NAME)?.status).toBe('warn');
        expect(checks.data.checks.some((check) => check.status === 'fail')).toBe(false);
        expect(process.exitCode).not.toBe(EXIT.UNEXPECTED);
      }),
    );
  });

  it('does not ask when the check is switched off', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        ctx.env['REFS_UPDATE_CHECK'] = '0';
        // Left rejecting on purpose: if the check consulted it anyway, this test would notice.
        const checks = await runDoctorJson(ctx, stdout);

        const check = findCheck(checks, CHECK_NAME);
        expect(check?.status).toBe('ok');
        expect(check?.detail).toMatch(/disabled/u);
      }),
    );
  });
});
