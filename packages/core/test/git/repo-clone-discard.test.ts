import type { RunOpts, RunResult, Runner } from '../../src/proc/runner.ts';
import { describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A clone that a timeout ends with SIGKILL gets no chance to remove its destination, and what it
// leaves already carries `.git` and the `core.hooksPath` marker from the clone's own `-c` — the two
// things the reuse path checks before adopting a checkout. The runner below lets the real clone
// finish and then reports it as timed out: the exact on-disk state of a clone killed after it had
// written everything, which a real SIGKILL can only produce by racing.
//
// The other half is what the removal must never touch: anything that was at `dest` before, and a
// `dest` that something else created after the check, which real git then refuses to clone into.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const TIMEOUT_EXIT_CODE = 124;

/** Real git, except that a clone reports a timeout after it has populated its destination. */
const killedAfterWriting = (): Runner => {
  const real = new SpawnRunner();
  return {
    run: async (cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> => {
      const result = await real.run(cmd, args, opts);
      if (args[0] !== 'clone') {
        return result;
      }
      return {
        exitCode: TIMEOUT_EXIT_CODE,
        stderr: 'refs: command timed out',
        stdout: '',
        timedOut: true,
      };
    },
  };
};

/** Real git, with `beforeClone` run just before the clone starts: another process's move. */
const racedBy = (beforeClone: () => Promise<void>): Runner => {
  const real = new SpawnRunner();
  return {
    run: async (cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> => {
      if (args[0] === 'clone') {
        await beforeClone();
      }
      return real.run(cmd, args, opts);
    },
  };
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const scratchDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-discard-'));

const cloneInto = async (dest: string, runner: Runner = killedAfterWriting()): Promise<unknown> => {
  const fixture = await createFixtureRepo();
  const hooksDir = await scratchDir();
  try {
    return await cloneRepo(runner, { cloneUrl: fixture.url, dest, hooksDir, mode: 'full' });
  } catch (error) {
    return error;
  }
};

describe('a clone that fails after writing', SUITE_OPTS, () => {
  it('removes the destination it created, so nothing can adopt it', async () => {
    expect.hasAssertions();
    const dest = join(await scratchDir(), 'sources', 'repo');
    const failed = await cloneInto(dest);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toContain('REFS_GIT_TIMEOUT');
    await expect(exists(dest)).resolves.toBe(false);
  });

  it('leaves a destination that existed before it alone', async () => {
    expect.hasAssertions();
    const dest = join(await scratchDir(), 'repo');
    await mkdir(dest);
    const failed = await cloneInto(dest);
    expect(failed).toBeInstanceOf(Error);
    await expect(exists(dest)).resolves.toBe(true);
  });
});

describe('a clone git refuses to start', SUITE_OPTS, () => {
  it('keeps what another process created at the destination after the check', async () => {
    expect.hasAssertions();
    // A concurrent run for the nested ref `<dest>/sub` creates its parent under its own lock.
    const dest = join(await scratchDir(), 'group', 'project');
    const nested = join(dest, 'sub', '.git', 'HEAD');
    const failed = await cloneInto(
      dest,
      racedBy(async () => {
        await mkdir(join(dest, 'sub', '.git'), { recursive: true });
        await writeFile(nested, 'ref: refs/heads/main\n');
      }),
    );
    expect((failed as Error).message).toContain('not an empty directory');
    await expect(exists(nested)).resolves.toBe(true);
  });

  it('keeps a dangling symlink at the destination', async () => {
    expect.hasAssertions();
    const root = await scratchDir();
    const dest = join(root, 'repo');
    await symlink(join(root, 'missing'), dest);
    const failed = await cloneInto(
      dest,
      racedBy(async () => {}),
    );
    expect(failed).toBeInstanceOf(Error);
    await expect(lstat(dest).then((entry) => entry.isSymbolicLink())).resolves.toBe(true);
  });
});
