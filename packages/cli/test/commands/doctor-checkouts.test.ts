import { EXIT, checkoutPath, zRefKey } from '@kaisers-io/refs-core';
import {
  HTTPS_REF_ENTRY,
  expectCheck,
  expectGitVersion,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

// `hooks-guard`/`dirty-checkouts` — both iterate configured refs whose checkout exists, running
// one scripted `git` command per checkout via `FakeRunner`. `markCheckoutPresent` stands in for a
// real clone (a bare `.git` directory is all `isGitCheckout` needs); the actual `git status`/
// `git config` output is scripted rather than exercised against a real repo, mirroring
// `list.test.ts`'s own "seed via writeConfig, never through a real refs add" approach — split out
// of `doctor.test.ts` purely to keep that file under the repo's 300-line oxlint cap.

const ALPHA_KEY = 'github.com/acme/alpha';

describe('refs doctor: (d) dirty checkout', () => {
  it('reports dirty-checkouts as warn, listing the affected key', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [ALPHA_KEY]: HTTPS_REF_ENTRY });
        const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
        await markCheckoutPresent(dest);
        expectGitVersion(runner);
        runner.expect(
          'git config --local --get core.hooksPath',
          { stdout: home.hooksDir },
          { cwd: dest },
        );
        runner.expect('git status --porcelain', { stdout: ' M README.md\n' }, { cwd: dest });

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'dirty-checkouts', { detailContains: ALPHA_KEY, status: 'warn' });
        expectCheck(envelope, 'hooks-guard', { status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: hooks-guard mismatch', () => {
  it("reports hooks-guard as fail when a checkout's core.hooksPath does not point at this home", async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [ALPHA_KEY]: HTTPS_REF_ENTRY });
        const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
        await markCheckoutPresent(dest);
        expectGitVersion(runner);
        runner.expect(
          'git config --local --get core.hooksPath',
          { stdout: '/some/other/hooks' },
          { cwd: dest },
        );
        runner.expect('git status --porcelain', { stdout: '' }, { cwd: dest });

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'hooks-guard', { detailContains: ALPHA_KEY, status: 'fail' });
      }),
    );
  });
});

describe('refs doctor: hooks-guard missing pre-push', () => {
  it('reports hooks-guard as fail naming pre-push when it is missing', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await unlink(join(home.hooksDir, 'pre-push'));
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'hooks-guard', { detailContains: 'pre-push', status: 'fail' });
        expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      }),
    );
  });
});

describe('refs doctor: broken checkout (git status fails)', () => {
  it('reports dirty-checkouts as fail (not ok) when git status exits non-zero', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [ALPHA_KEY]: HTTPS_REF_ENTRY });
        const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
        await markCheckoutPresent(dest);
        expectGitVersion(runner);
        runner.expect(
          'git config --local --get core.hooksPath',
          { stdout: home.hooksDir },
          { cwd: dest },
        );
        runner.expect(
          'git status --porcelain',
          { exitCode: 128, stderr: 'fatal: not a git repository', stdout: '' },
          { cwd: dest },
        );

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'dirty-checkouts', {
          detailContains: `${ALPHA_KEY}: git status failed`,
          status: 'fail',
        });
        expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      }),
    );
  });
});
