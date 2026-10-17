import type { RunOpts, RunResult, Runner } from '../../src/proc/runner.ts';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
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

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const scratchDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-discard-'));

const cloneInto = async (dest: string): Promise<unknown> => {
  const fixture = await createFixtureRepo();
  const hooksDir = await scratchDir();
  try {
    return await cloneRepo(killedAfterWriting(), {
      cloneUrl: fixture.url,
      dest,
      hooksDir,
      mode: 'full',
    });
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
