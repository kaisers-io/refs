import { CLAIMS_DIRNAME, EXIT } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectCheck,
  expectGitVersion,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The `locks` check. It exists because a held lock used to be invisible: acquisition failed with a
// message naming no owner, and `doctor` had no lock check at all — so the one command meant to
// answer "is something stuck?" could not see the thing that was stuck.

// The largest pid `process.kill` accepts, and far above any platform's `pid_max`, so it can never
// name a live process however busy the machine is.
const DEAD_PID = 2_147_483_647;
const TOKEN = '11111111-2222-4333-8444-555555555555';
const AN_HOUR_MS = 3_600_000;

/** A lock whose lease timestamp is in the FUTURE. Every age in the report derives from it, so a
 * clock running backwards makes them all meaningless — a finding rather than a negative number. */
const seedSkewedLock = async (locksDir: string): Promise<void> => {
  const lockPath = join(locksDir, 'home');
  await mkdir(lockPath, { recursive: true });
  const sidecar = join(lockPath, `lease-${TOKEN}`);
  await writeFile(sidecar, '');
  // The lease is measured from the sidecar's mtime, so that is where the skew has to be.
  const ahead = new Date(Date.now() + AN_HOUR_MS);
  await utimes(sidecar, ahead, ahead);
  const meta = { acquired_at: new Date().toISOString(), pid: process.pid, token: TOKEN };
  await writeFile(join(lockPath, 'meta.json'), JSON.stringify(meta));
};

const seedLock = async (locksDir: string, name: string, pid: number): Promise<void> => {
  const lockPath = join(locksDir, name);
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, `lease-${TOKEN}`), '');
  await writeFile(
    join(lockPath, 'meta.json'),
    JSON.stringify({ acquired_at: new Date().toISOString(), pid, token: TOKEN }),
  );
};

describe('refs doctor: locks check with nothing held', () => {
  it('reports ok when no lock is held', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'locks', { detailContains: 'no locks held', status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: locks check with a healthy holder', () => {
  it('lists a live holder as ok, since a held lock is what a concurrent sync looks like', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedLock(home.locksDir, 'home', process.pid);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        // Listed, not warned about: "ok" here means the locking mechanism looks healthy, not that
        // the home is idle. Warning on ordinary concurrency would train the reader to ignore it.
        expectCheck(envelope, 'locks', {
          detailContains: `recorded pid ${process.pid} present`,
          status: 'ok',
        });
      }),
    );
  });
});

describe('refs doctor: locks check on an entry it cannot read', () => {
  it('warns rather than reporting ok when the entry could not be inspected', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        // A lock directory with no metadata and no readable timestamp: present, but nothing about
        // it can be established.
        await mkdir(join(home.locksDir, 'home'), { recursive: true });
        await writeFile(join(home.locksDir, 'home', 'meta.json'), '{ not json');
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        // Reporting `ok` here would be the one failure this check exists to avoid: a clean bill of
        // health from a look that did not happen.
        expectCheck(envelope, 'locks', { detailContains: 'owner unknown', status: 'warn' });
      }),
    );
  });
});

describe('refs doctor: locks check on a non-directory', () => {
  it('warns about something that is not a lock occupying a lock name', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        // Nothing legitimate puts a file where a lock belongs. It clears itself once the metadata
        // grace elapses, so the message must not claim it blocks forever — but it is still worth
        // a look.
        await mkdir(home.locksDir, { recursive: true });
        await writeFile(join(home.locksDir, 'home'), '');
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'locks', { detailContains: 'not a directory', status: 'warn' });
      }),
    );
  });
});

describe('refs doctor: locks check on a clock running backwards', () => {
  it('says the recorded time is in the future rather than printing a negative age', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedSkewedLock(home.locksDir);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        // Every age in the report derives from this timestamp, so a clock running backwards makes
        // them all meaningless — which is a finding, not something to render as a negative number.
        expectCheck(envelope, 'locks', {
          detailContains: 'recorded time is in the future',
          status: 'warn',
        });
      }),
    );
  });
});

describe('refs doctor: locks check with a dead holder', () => {
  it('warns about a lock whose recorded process is gone, without failing the run', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedLock(home.locksDir, 'ref.github.com_acme_alpha', DEAD_PID);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'locks', {
          detailContains: `recorded pid ${DEAD_PID} is not running`,
          status: 'warn',
        });
        // A warn must not change the exit code — only `fail` does. Someone scripting `refs doctor`
        // should not see a leftover lock as a broken environment.
        expect(process.exitCode).not.toBe(EXIT.UNEXPECTED);
      }),
    );
  });
});

/** The `locks` check's detail text, or an empty string if the check is somehow absent. Hoisted out
 * of the test bodies because the fallback is a conditional, which `vitest/no-conditional-in-test`
 * disallows inside `it()`. */
const locksDetailOf = (envelope: Awaited<ReturnType<typeof runDoctorJson>>): string =>
  envelope.data.checks.find((check) => check.name === 'locks')?.detail ?? '';

/** An aged claim marker, and the `locks` detail it produces. Hoisted out of the test body: the
 * lookup needs a fallback, and `vitest/no-conditional-in-test` disallows branching inside `it()`. */
const seedAgedClaimAndReport = async (
  setup: Awaited<ReturnType<typeof setupInitializedHome>>,
): Promise<string> => {
  const claimPath = join(setup.home.locksDir, CLAIMS_DIRNAME, 'home');
  await mkdir(claimPath, { recursive: true });
  const aged = new Date(Date.now() - AN_HOUR_MS);
  await utimes(claimPath, aged, aged);
  expectGitVersion(setup.runner);
  return locksDetailOf(await runDoctorJson(setup.ctx, setup.stdout));
};

describe('refs doctor: steal claims', () => {
  it('reports a leftover claim and the one command that clears it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        // A claim marker with no steal behind it — what a crashed stealer leaves. Since claims
        // stopped being reclaimed by age, nothing removes it on its own, so `doctor` has to say
        // it is there and what to do about it.
        await mkdir(join(home.locksDir, CLAIMS_DIRNAME, 'home'), { recursive: true });
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'locks', { detailContains: 'steal claim on home', status: 'warn' });
      }),
    );
  });

  it('does not call the stealer crashed, because age does not establish that', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);

        const detail = await seedAgedClaimAndReport(setup);

        // An hour old and still not diagnosed as abandoned: a suspended stealer looks exactly the
        // same, and clearing its claim by hand is what recreates the bug this all exists to stop.
        expect(detail).not.toMatch(/crashed|abandoned|dead/u);
        expect(detail).toContain('stop every refs process');
        expect(detail).toContain('rmdir');
      }),
    );
  });
});

describe('refs doctor: locks refs will not reclaim', () => {
  it('prints the repair command and its precondition, not a pointer back to doctor', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        // A crash before the metadata was published. Nothing identifies the acquisition, so refs
        // will never reclaim it on its own — which makes this exactly the case that has to carry
        // its own way out.
        await mkdir(join(home.locksDir, 'home'), { recursive: true });
        const aged = new Date(Date.now() - AN_HOUR_MS);
        await utimes(join(home.locksDir, 'home'), aged, aged);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'locks', {
          detailContains: 'not automatically reclaimable',
          status: 'warn',
        });
        const detail = locksDetailOf(envelope);
        expect(detail).toContain('rm -rf');
        expect(detail).toContain('stop every refs process');
      }),
    );
  });
});
