import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A remote that accepts the connection and then never answers — a stalled server, or a transport
// waiting at a prompt nobody will answer. The "ssh" here is a script that reads its input and says
// nothing, so it ends when git does, the way a real transport does when its parent goes away.
// Without a deadline refs would wait on it indefinitely, holding the per-ref lock.

const runner = new SpawnRunner();
const DEADLINE_MS = 500;
// Generous next to the deadline, small next to "forever": the bound is the deadline plus git's
// wind-down, not an exact wall-clock limit.
const WITHIN_MS = 15_000;
const SUITE_OPTS = { timeout: 30_000 };
const SCRIPT_MODE = 0o755;
const STALLED_URL = 'ssh://refs-stalled.invalid/o/r.git';
const SUCCESS_EXIT_CODE = 0;

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
};

/** Runs `fn` with git's ssh transport replaced by one that never answers. */
const scratchDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-stall-'));

/** Runs `fn` with `GIT_SSH_COMMAND` set to `stub` and `GIT_TERMINAL_PROMPT` unset. */
const withSsh = async <Result>(stub: string, fn: () => Promise<Result>): Promise<Result> => {
  const previous = {
    prompt: process.env['GIT_TERMINAL_PROMPT'],
    ssh: process.env['GIT_SSH_COMMAND'],
  };
  Reflect.deleteProperty(process.env, 'GIT_TERMINAL_PROMPT');
  process.env['GIT_SSH_COMMAND'] = stub;
  try {
    return await fn();
  } finally {
    restore('GIT_SSH_COMMAND', previous.ssh);
    restore('GIT_TERMINAL_PROMPT', previous.prompt);
  }
};

const writeStub = async (path: string, body: string): Promise<void> => {
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, SCRIPT_MODE);
};

const withStalledSsh = async <Result>(fn: () => Promise<Result>): Promise<Result> => {
  const stub = join(await scratchDir(), 'ssh');
  // `cat` reads git's requests until git goes away; the shell keeps the pipe git reads from open.
  await writeStub(stub, 'cat > /dev/null');
  return withSsh(stub, fn);
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** Resolves to the thrown message and how long it took. */
const timed = async (work: () => Promise<unknown>): Promise<{ ms: number; message: string }> => {
  const started = Date.now();
  const failed: unknown = await work().then(
    () => new Error('resolved'),
    (error: unknown) => error,
  );
  return { message: (failed as Error).message, ms: Date.now() - started };
};

/** A managed checkout of a fixture whose `origin` now points at the stalled remote. */
const checkoutWithStalledOrigin = async (): Promise<{ dest: string; hooksDir: string }> => {
  const scratch = await scratchDir();
  const fixture = await createFixtureRepo();
  const dest = join(scratch, 'checkout');
  const hooksDir = join(scratch, 'hooks');
  await cloneRepo(runner, { cloneUrl: fixture.url, dest, hooksDir, mode: 'full' });
  const repoint = await runner.run('git', ['remote', 'set-url', 'origin', STALLED_URL], {
    cwd: dest,
  });
  expect(repoint.exitCode).toBe(SUCCESS_EXIT_CODE);
  return { dest, hooksDir };
};

describe('a remote that never answers', SUITE_OPTS, () => {
  it.skipIf(process.platform === 'win32')(
    'stops a clone at the deadline and leaves no checkout behind',
    async () => {
      expect.hasAssertions();
      const dest = join(await scratchDir(), 'checkout');
      const clone = (): Promise<unknown> =>
        cloneRepo(runner, {
          cloneUrl: STALLED_URL,
          dest,
          hooksDir: join(dest, '..', 'hooks'),
          mode: 'full',
          networkTimeoutMs: DEADLINE_MS,
        });

      const { message, ms } = await withStalledSsh(() => timed(clone));

      expect(message).toBe('git clone timed out after 0.5s (REFS_NETWORK_TIMEOUT) and was stopped');
      expect(ms).toBeLessThan(WITHIN_MS);
      await expect(exists(dest)).resolves.toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')('stops a sync fetch at the deadline', async () => {
    expect.hasAssertions();
    const { dest, hooksDir } = await checkoutWithStalledOrigin();
    const sync = (): Promise<unknown> =>
      syncRef(runner, {
        defaultBranch: 'main',
        dir: dest,
        hooksDir,
        networkTimeoutMs: DEADLINE_MS,
      });

    const { message, ms } = await withStalledSsh(() => timed(sync));

    expect(message).toBe('git fetch timed out after 0.5s (REFS_NETWORK_TIMEOUT) and was stopped');
    expect(ms).toBeLessThan(WITHIN_MS);
    await expect(exists(join(dest, '.git'))).resolves.toBe(true);
  });
});

// The prompt setting reaches the processes git itself starts, which is where a credential prompt
// would come from. The stub records what it was given and fails the connection.
describe('the transport git starts for refs', SUITE_OPTS, () => {
  it.skipIf(process.platform === 'win32')('is told not to prompt on the terminal', async () => {
    expect.hasAssertions();
    const scratch = await scratchDir();
    const seen = join(scratch, 'seen');
    await writeStub(join(scratch, 'ssh'), `printf %s "$GIT_TERMINAL_PROMPT" > '${seen}'; exit 1`);
    const clone = (): Promise<unknown> =>
      cloneRepo(runner, {
        cloneUrl: STALLED_URL,
        dest: join(scratch, 'checkout'),
        hooksDir: scratch,
        mode: 'full',
      });

    const { message } = await withSsh(join(scratch, 'ssh'), () => timed(clone));

    expect(message).toContain('git clone failed');
    await expect(readFile(seen, 'utf8')).resolves.toBe('0');
  });
});
