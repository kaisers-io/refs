import { describe, expect, it } from 'vitest';
import {
  expectCheck,
  expectGitVersion,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { EXIT } from '@kaisers-io/refs-core';
import { join } from 'node:path';

// The `locks` check. It exists because a held lock used to be invisible: acquisition failed with a
// message naming no owner, and `doctor` had no lock check at all — so the one command meant to
// answer "is something stuck?" could not see the thing that was stuck.

// Above macOS/Linux default pid_max, so it can never name a live process.
const DEAD_PID = 999_999;
const TOKEN = '11111111-2222-4333-8444-555555555555';

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
