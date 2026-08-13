import { EXIT, resolveHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectGitVersion,
  findCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CliContext } from '../../src/context.ts';
import type { Fetcher } from '@kaisers-io/refs-core';

// The `cli-update` check. It is one of only two places refs contacts the registry, and the only one
// that reports the answer as a check — so what matters here is that it never turns a healthy
// machine into a failing one, and that it stays quiet about anything it cannot order.
//
// `testContext`'s default fetcher rejects, so nothing below reaches the network unless it stubs one.
const CHECK_NAME = 'cli-update';

const HTTP_OK = 200;
// Comfortably past the 24h cache ttl, so a seeded entry forces a refresh attempt.
const TWO_DAYS_MS = 172_800_000;

const respondingWith =
  (version: string): Fetcher =>
  () =>
    Promise.resolve({ json: () => Promise.resolve({ version }), status: HTTP_OK });

/** Writes a cache entry dated well outside the 24h ttl, so the next read has to try the network. */
const seedExpiredCache = async (ctx: CliContext, version: string): Promise<void> => {
  const home = resolveHome(ctx.env);
  await mkdir(home.cacheDir, { recursive: true });
  const checkedAt = new Date(Date.now() - TWO_DAYS_MS).toISOString();
  const body = JSON.stringify({ checked_at: checkedAt, latest_version: version });
  await writeFile(home.updateCachePath, body);
};

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
});

describe('refs doctor: cli-update with an expired cache', () => {
  it('never passes off an expired cached answer as npm’s current state', async () => {
    // The cache is deliberately older than its ttl and the registry is unreachable, so the only
    // answer available is the last one npm gave. Reporting "this CLI is npm's latest release" from
    // that would be a claim about a registry we just failed to reach.
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        ctx.cliVersion = '0.9.0';
        await seedExpiredCache(ctx, '0.9.0');
        ctx.fetcher = () => Promise.reject(new Error('offline'));

        const checks = await runDoctorJson(ctx, stdout);

        const check = findCheck(checks, CHECK_NAME);
        expect(check?.status).toBe('warn');
        expect(check?.detail).toMatch(/could not reach npm/u);
        expect(check?.detail).not.toMatch(/is npm's latest published release/u);
      }),
    );
  });
});

describe('refs doctor: cli-update when it is switched off', () => {
  it('names CI as the reason when that is why it did not ask', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        ctx.env['CI'] = 'true';

        const checks = await runDoctorJson(ctx, stdout);

        const check = findCheck(checks, CHECK_NAME);
        expect(check?.detail).toMatch(/off in CI/u);
        // The config switch is untouched here, so pointing at it would send the user looking for a
        // line that does not exist.
        expect(check?.detail).not.toMatch(/config\.toml/u);
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
        // Names the switch that is actually off. Telling a CI machine to remove a config line it
        // does not have would be worse than saying nothing.
        expect(check?.detail).toBe('update check is off (REFS_UPDATE_CHECK=0)');
      }),
    );
  });
});
