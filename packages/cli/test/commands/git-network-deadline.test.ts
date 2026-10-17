import { access, mkdtemp, rm } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '@kaisers-io/refs-core';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { tmpdir } from 'node:os';
import { withGitServer } from '../helpers/stalled-git-server.ts';

const success = async (
  runner: SpawnRunner,
  args: readonly string[],
  cwd?: string,
): Promise<string> => {
  const result = await runner.run('git', args, cwd === undefined ? {} : { cwd });
  expect({
    exitCode: result.exitCode,
    stderr: result.exitCode === 0 ? '' : result.stderr,
  }).toStrictEqual({ exitCode: 0, stderr: '' });
  return result.stdout;
};

const cleanupFixture = async (runner: SpawnRunner, temp: string): Promise<void> => {
  vi.unstubAllEnvs();
  // Closing the synthetic server does not prove every Git descendant stopped. Preserve the
  // disposable checkout after uncertainty rather than race a writer during fixture cleanup.
  if (!runner.terminationFailed) {
    await rm(temp, { force: true, recursive: true });
  }
};

const withPartialClone = async (
  exercise: (dir: string, runner: SpawnRunner) => Promise<void>,
): Promise<void> => {
  const runner = new SpawnRunner();
  const source = await createFixtureRepo({});
  const temp = await mkdtemp(join(tmpdir(), 'refs-lazy-network-'));
  const dest = join(temp, 'partial');
  try {
    await success(runner, ['config', 'uploadpack.allowFilter', 'true'], source.dir);
    await success(runner, ['clone', '--filter=blob:none', '--no-checkout', '--', source.url, dest]);
    await exercise(dest, runner);
  } finally {
    await cleanupFixture(runner, temp);
  }
};

const expectNetworkDeadline = async (
  dir: string,
  args: readonly string[],
  runner: SpawnRunner,
): Promise<void> => {
  await withGitServer(false, async (url) => {
    await success(runner, ['remote', 'set-url', 'origin', url], dir);
    vi.stubEnv('REFS_GIT_TIMEOUT_MS', '1000');
    const result = await runner.run('git', args, { cwd: dir });
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain('timed out after 1000ms');
    await expect(access(join(dir, '.git'))).resolves.toBeUndefined();
  });
};

const removeRetainedFixture = async (dir: string): Promise<void> => {
  if (dir !== '') {
    await rm(dirname(dir), { force: true, recursive: true });
  }
};

describe('all real Git network paths have deadlines', { timeout: SLOW_IO_TIMEOUT_MS }, () => {
  it.each([
    ['fetch', 'origin'],
    ['remote', 'set-head', 'origin', '--auto'],
    ['show', 'HEAD:README.md'],
    ['checkout', '-f', 'HEAD'],
  ])(
    'bounds %j, including lazy missing-blob fetches, without deleting existing checkouts',
    async (...args) => {
      expect.hasAssertions();
      await withPartialClone((dir, runner) => expectNetworkDeadline(dir, args, runner));
    },
  );

  it('preserves an uncertain fixture and gives the next case a fresh runner', async () => {
    expect.hasAssertions();
    let retained = '';
    try {
      await withPartialClone(async (dir, runner) => {
        retained = dir;
        // All setup children have closed; simulate uncertainty without leaking a real writer.
        runner.terminationFailed = true;
        await expect(access(join(dir, '.git'))).resolves.toBeUndefined();
      });
      await expect(access(join(retained, '.git'))).resolves.toBeUndefined();
      await withPartialClone(async (_dir, runner) => {
        expect(runner.terminationFailed).toBe(false);
        await expect(runner.run('git', ['--version'])).resolves.toMatchObject({ exitCode: 0 });
      });
    } finally {
      // This test introduced only a latch, never an unconfirmed live child.
      await removeRetainedFixture(retained);
    }
  });
});
