import type { DoctorEnvelope, DoctorTestHome } from '../helpers/doctor-support.ts';
import { EXIT, SpawnRunner, checkoutPath, zRefKey } from '@kaisers-io/refs-core';
import {
  HTTPS_REF_ENTRY,
  expectCheck,
  expectGitVersion,
  findCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The mode `installHooksGuard` uses, so the fixture has the shape refs writes.
const HOOK_MODE = 0o755;

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

// git resolves hook NAMES against `core.hooksPath`, not against the two names refs installed
// there. Measured on git 2.54: a `post-checkout` placed in that directory RUNS during `refs sync`
// — so a check that reports the guard `ok` from two filenames is true of less than it claims.

/** The `hooks-guard` detail, or a thrown fixture error — an absent check is a broken fixture
 * rather than a branch worth asserting on (`vitest/no-conditional-in-test`). */
const hooksGuardDetail = (envelope: DoctorEnvelope): string => {
  const detail = findCheck(envelope, 'hooks-guard')?.detail;
  if (detail === undefined) {
    throw new Error('expected a hooks-guard check in the envelope');
  }
  return detail;
};

const REMOVAL_MARKER = 'remove: ';
const SUCCESS_EXIT = 0;
const NOT_FOUND = -1;

/** The removal command out of the reported detail, taken as printed. */
const removalFrom = (detail: string): string => {
  const at = detail.indexOf(REMOVAL_MARKER);
  if (at === NOT_FOUND) {
    throw new Error(`expected a removal command in: ${detail}`);
  }
  return detail.slice(at + REMOVAL_MARKER.length).split('; ')[0] ?? '';
};

/** A home with one existing checkout whose `git` calls are already scripted. */
const homeWithCheckout = async (homeDir: string): Promise<DoctorTestHome> => {
  const setup = await setupInitializedHome(homeDir);
  await seedConfig(setup.home, { [ALPHA_KEY]: HTTPS_REF_ENTRY });
  const dest = checkoutPath(setup.home, zRefKey.parse(ALPHA_KEY));
  await markCheckoutPresent(dest);
  expectGitVersion(setup.runner);
  setup.runner.expect(
    'git config --local --get core.hooksPath',
    { stdout: setup.home.hooksDir },
    { cwd: dest },
  );
  setup.runner.expect('git status --porcelain', { stdout: '' }, { cwd: dest });
  return setup;
};

describe('refs doctor: a hooks directory holding something refs did not install', () => {
  it('fails, naming the entry and a removal that names its real path', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await homeWithCheckout(homeDir);
        await writeFile(join(setup.home.hooksDir, 'post-checkout'), '#!/bin/sh\n', {
          mode: HOOK_MODE,
        });

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, 'hooks-guard', {
          detailContains: 'hooks/post-checkout: not installed by refs',
          status: 'fail',
        });
        expect(hooksGuardDetail(envelope)).toContain(
          `remove: rm -rf -- '${join(setup.home.hooksDir, 'post-checkout')}'`,
        );
      }),
    );
  });

  it('prints one removal that actually clears the directory when run as printed', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, stdout } = await setupInitializedHome(homeDir);
        // `notes.txt` is not executable and is not a hook name git knows: still reported. Which
        // names a given git invokes is a property of that git, and enumerating exists to stop
        // deciding from a list. The space in the second name is what makes the removal a quoting
        // question rather than a string-formatting one.
        await writeFile(join(home.hooksDir, 'notes.txt'), 'x');
        await writeFile(join(home.hooksDir, 'post merge'), '#!/bin/sh\n', { mode: HOOK_MODE });

        const envelope = await runDoctorJson(ctx, stdout);

        const removal = removalFrom(hooksGuardDetail(envelope));
        const result = await new SpawnRunner().run('sh', ['-c', removal]);

        expect(result.exitCode).toBe(SUCCESS_EXIT);
        await expect(readdir(home.hooksDir)).resolves.toStrictEqual(['pre-commit', 'pre-push']);
      }),
    );
  });
});

describe('refs doctor: the hooks directory after the repair', () => {
  it('is ok again once it holds only what refs installed', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, stdout } = await setupInitializedHome(homeDir);
        await writeFile(join(home.hooksDir, 'post-merge'), '#!/bin/sh\n', { mode: HOOK_MODE });
        await runDoctorJson(ctx, stdout);
        await rm(join(home.hooksDir, 'post-merge'));

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'hooks-guard', { status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: a home whose hooks directory is not there at all', () => {
  it('says what to run rather than reporting a crashed check', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, stdout } = await setupInitializedHome(homeDir);
        await rm(home.hooksDir, { recursive: true });

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'hooks-guard', {
          detailContains: 'missing or not executable — run: refs init',
          status: 'fail',
        });
        expect(hooksGuardDetail(envelope)).not.toContain('crashed');
      }),
    );
  });
});
