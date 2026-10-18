import type { RunOpts, RunResult, Runner } from '../../src/proc/runner.ts';
import { describe, expect, it } from 'vitest';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { FakeRunner } from '../../src/proc/fake-runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A clone that fails can leave `dest` with `.git` and the managed `core.hooksPath` already in it —
// git removes its own junk on SIGTERM, but not after the SIGKILL a timeout escalates to. `refs
// add`'s reuse path would adopt that as a finished checkout, so a `dest` the clone created is
// removed, and one that was already there never is.

const TIMEOUT_MS = 5000;
const KILLED = 137;

/** Plays a clone that got as far as writing `.git/config` before refs stopped it. */
class HalfCloneRunner implements Runner {
  readonly seen: (RunOpts | undefined)[] = [];

  async run(_cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> {
    this.seen.push(opts);
    const dest = args.findLast(() => true) ?? '';
    await mkdir(join(dest, '.git'), { recursive: true });
    await writeFile(join(dest, '.git', 'config'), '[core]\n\thooksPath = /refs/hooks\n');
    return { exitCode: KILLED, stderr: 'Cloning into…', stdout: '', timedOut: true };
  }
}

/** A clone that fails before creating anything, as git does when `dest` is a dangling symlink. */
const refusedClone: Runner = {
  run: () =>
    Promise.resolve({
      exitCode: 128,
      stderr: 'fatal: could not create work tree dir: File exists',
      stdout: '',
    }),
};

/** Something else creates `dest`, without `.git`, while the clone runs and fails. */
const concurrentDir: Runner = {
  run: async (_cmd, args) => {
    const dest = args.findLast(() => true) ?? '';
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'theirs.txt'), 'not refs\n');
    return { exitCode: 128, stderr: 'fatal: destination path already exists', stdout: '' };
  },
};

/** The clone fails after `.git` appeared behind `dest`, through a symlink that dangled before. */
const throughLink = (target: string): Runner => ({
  run: async () => {
    await mkdir(join(target, '.git'), { recursive: true });
    return { exitCode: 128, stderr: 'fatal: early EOF', stdout: '' };
  },
});

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** A fresh scratch directory, and a `checkout` path inside it that does not exist yet. */
const freshDest = async (): Promise<string> => {
  const scratch = await mkdtemp(join(tmpdir(), 'refs-half-'));
  return join(scratch, 'checkout');
};

const cloneInto = (runner: Runner, dest: string): Promise<unknown> =>
  cloneRepo(runner, {
    cloneUrl: 'https://example.com/o/r.git',
    dest,
    hooksDir: '/refs/hooks',
    mode: 'full',
    networkTimeoutMs: TIMEOUT_MS,
  });

describe('a clone refs stopped at its network deadline', () => {
  it('says so, and removes the checkout directory it had started', async () => {
    expect.hasAssertions();
    const dest = await freshDest();

    await expect(cloneInto(new HalfCloneRunner(), dest)).rejects.toThrow(
      'git clone timed out after 5s (REFS_NETWORK_TIMEOUT) and was stopped',
    );
    await expect(exists(dest)).resolves.toBe(false);
  });

  it('leaves a directory that was there before the clone alone', async () => {
    expect.hasAssertions();
    const dest = await mkdtemp(join(tmpdir(), 'refs-half-'));
    await writeFile(join(dest, 'keep.txt'), 'mine\n');

    await expect(cloneInto(new HalfCloneRunner(), dest)).rejects.toThrow('timed out');
    await expect(readFile(join(dest, 'keep.txt'), 'utf8')).resolves.toBe('mine\n');
  });

  it('runs the clone under the deadline it was given', async () => {
    expect.hasAssertions();
    const runner = new HalfCloneRunner();
    const dest = await freshDest();

    await cloneInto(runner, dest).catch((error: unknown) => error);

    expect(runner.seen).toStrictEqual([{ timeoutMs: TIMEOUT_MS }]);
  });
});

describe('a failed clone and a dest it did not create', () => {
  // Symlinks need privileges on Windows; the logic under test has no platform branch.
  it.skipIf(process.platform === 'win32')(
    'keeps a dangling symlink that was there before',
    async () => {
      expect.hasAssertions();
      const dest = await freshDest();
      await symlink(join(dest, '..', 'nowhere'), dest);

      await expect(cloneInto(refusedClone, dest)).rejects.toThrow('File exists');
      await expect(lstat(dest).then((entry) => entry.isSymbolicLink())).resolves.toBe(true);
      await expect(readlink(dest)).resolves.toBe(join(dest, '..', 'nowhere'));
    },
  );

  it.skipIf(process.platform === 'win32')(
    'keeps a symlink that dangled before, even once .git shows through it',
    async () => {
      expect.hasAssertions();
      const dest = await freshDest();
      const target = join(dest, '..', 'elsewhere');
      await symlink(target, dest);

      await expect(cloneInto(throughLink(target), dest)).rejects.toThrow('early EOF');
      await expect(lstat(dest).then((entry) => entry.isSymbolicLink())).resolves.toBe(true);
    },
  );

  it('keeps a directory without .git that appeared while the clone ran', async () => {
    expect.hasAssertions();
    const dest = await freshDest();

    await expect(cloneInto(concurrentDir, dest)).rejects.toThrow('already exists');
    await expect(readFile(join(dest, 'theirs.txt'), 'utf8')).resolves.toBe('not refs\n');
  });
});

describe('a clone without a network deadline', () => {
  it('passes none to the runner', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git -c core.hooksPath=/refs/hooks clone', {});
    runner.expect('git config core.hooksPath', {});

    await cloneRepo(runner, {
      cloneUrl: 'https://example.com/o/r.git',
      dest: '/tmp/refs-no-deadline',
      hooksDir: '/refs/hooks',
      mode: 'full',
    });

    expect(runner.calls[0]?.timeoutMs).toBeUndefined();
  });
});
