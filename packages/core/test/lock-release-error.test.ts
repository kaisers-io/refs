import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { resolveHome } from '../src/home.ts';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { withLock } from '../src/lock.ts';

// Releasing the lock is real I/O and can fail. It runs on the way out of every hold, including a
// hold whose callback already failed — so unless the failure is captured rather than awaited bare,
// an unlink error silently REPLACES the caller's real error. That is a quiet, expensive failure
// mode: the caller is told the lock broke when actually their operation did. `rm` is mocked here
// because a release failure cannot be provoked deterministically on POSIX.

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rm: vi.fn<typeof actual.rm>(actual.rm) };
});

const makeHome = (): ReturnType<typeof resolveHome> => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-lock-release-'));
  return resolveHome({ REFS_HOME: dir });
};

describe('withLock release failure precedence', () => {
  it("lets the callback's own error win over a failing release", async () => {
    expect.hasAssertions();
    const home = makeHome();
    // The only `rm` in a hold with no steal is the release itself.
    vi.mocked(rm).mockRejectedValueOnce(new Error('EACCES: could not remove the lock'));

    const held = withLock(home, 'home', () => Promise.reject(new Error('the actual work failed')));

    // The caller must learn what really went wrong. A release failure is bookkeeping; masking the
    // real error with it would send whoever reads the message chasing the wrong problem.
    await expect(held).rejects.toThrow('the actual work failed');
  });

  it('reports a failing release when the callback itself succeeded', async () => {
    expect.hasAssertions();
    const home = makeHome();
    vi.mocked(rm).mockRejectedValueOnce(new Error('EACCES: could not remove the lock'));

    const held = withLock(home, 'home', () => Promise.resolve('done'));

    // With nothing else to report, the release failure is the whole story and must not be
    // swallowed — a lock directory that could not be removed will block the next holder.
    await expect(held).rejects.toThrow('EACCES: could not remove the lock');
  });
});
