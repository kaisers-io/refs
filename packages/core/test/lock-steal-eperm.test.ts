import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Windows refuses to rename a directory while any other process holds an open handle inside it
// (sharing violation → EPERM). The steal pipeline must treat that exactly like losing the race:
// leave the lock in place and let the acquire loop retry. This mocks fs/promises.rename because a
// real cross-process handle-contention EPERM cannot be provoked deterministically on POSIX.

const eperm = (): never => {
  const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
  err.code = 'EPERM';
  throw err;
};

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rename: vi.fn<typeof actual.rename>(actual.rename) };
});

describe('lock steal: EPERM on tombstone rename', () => {
  it('treats EPERM as a lost race — lock survives the attempt, withLock still succeeds', async () => {
    expect.hasAssertions();
    const fs = await import('node:fs/promises');
    const { withLock } = await import('../src/lock.ts');
    const { resolveHome } = await import('../src/home.ts');
    const tmpPrefix = join(tmpdir(), 'refs-lock-eperm-');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const home = resolveHome({ REFS_HOME: mkdtempSync(tmpPrefix) });
    // Pre-seed an abandoned lock: meta.json with a long-dead timestamp (well past the 10-minute
    // staleness threshold), so the acquire loop goes down the steal path immediately.
    await fs.mkdir(join(home.locksDir, 'home'), { recursive: true });
    await fs.writeFile(
      join(home.locksDir, 'home', 'meta.json'),
      JSON.stringify({ acquired_at: new Date(0).toISOString(), pid: process.pid, token: 'stale' }),
      'utf8',
    );
    // The first tombstone rename fails with EPERM (simulated handle contention); the retry loop's
    // next steal attempt goes through the real rename and succeeds.
    vi.mocked(fs.rename).mockImplementationOnce(eperm);
    await expect(withLock(home, 'home', () => Promise.resolve('ran'))).resolves.toBe('ran');
  });
});
