import { describe, expect, it, vi } from 'vitest';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';
import { withLock } from '../src/lock.ts';

// Windows surfaces EPERM in two spots of the steal pipeline where POSIX never does: renaming the
// lock dir while another process holds a handle inside it (sharing violation), and re-mkdir-ing a
// claim dir that is still delete-pending after another waiter's rm. Both must be treated exactly
// like losing the race — leave things be, let the acquire loop retry. The fs primitives are
// mocked because neither failure can be provoked deterministically on POSIX.

const eperm = (): never => {
  const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
  err.code = 'EPERM';
  throw err;
};

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  // `mkdir` is overloaded (its return type depends on `recursive`); vi.fn's inferred mock type
  // can't reproduce every overload, so the mock is cast back to the original signature.
  const mkdirSpy = vi.fn<typeof actual.mkdir>(
    actual.mkdir as never,
  ) as unknown as typeof actual.mkdir;
  return { ...actual, mkdir: mkdirSpy, rename: vi.fn<typeof actual.rename>(actual.rename) };
});

// Pre-seeds an abandoned lock: meta.json with a long-dead timestamp (well past the 10-minute
// staleness threshold), so the acquire loop goes down the steal path immediately.
const seedStaleHomeLock = async (): Promise<ReturnType<typeof resolveHome>> => {
  const tmpPrefix = join(tmpdir(), 'refs-lock-eperm-');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const home = resolveHome({ REFS_HOME: mkdtempSync(tmpPrefix) });
  await mkdir(join(home.locksDir, 'home'), { recursive: true });
  await writeFile(
    join(home.locksDir, 'home', 'meta.json'),
    JSON.stringify({ acquired_at: new Date(0).toISOString(), pid: process.pid, token: 'stale' }),
    'utf8',
  );
  return home;
};

// Arms a one-shot EPERM for the next `.steal-claim` mkdir; every other mkdir (the locks dir, the
// recycled lock) stays real so the retry can actually win. Returns a probe reporting whether the
// simulated failure fired. The conditionals live here, outside any `it()` body
// (vitest/no-conditional-in-test). `getMockImplementation()` is the wrapped ORIGINAL mkdir —
// `mkdir` itself is the spy; calling it from inside the replacement would recurse forever.
const armClaimMkdirEperm = (): (() => boolean) => {
  const realMkdir = vi.mocked(mkdir).getMockImplementation();
  if (realMkdir === undefined) {
    throw new Error('mkdir spy has no wrapped implementation');
  }
  let fired = false;
  vi.mocked(mkdir).mockImplementation((path, options) => {
    if (!fired && String(path).endsWith('.steal-claim')) {
      fired = true;
      eperm();
    }
    return realMkdir(path, options);
  });
  return () => fired;
};

describe('lock steal: Windows-style EPERM as lost race', () => {
  it('tombstone rename EPERM — lock survives the attempt, withLock still succeeds', async () => {
    expect.hasAssertions();
    const home = await seedStaleHomeLock();
    // The first tombstone rename fails with EPERM (simulated handle contention); the retry
    // loop's next steal attempt goes through the real rename and succeeds.
    vi.mocked(rename).mockImplementationOnce(eperm);
    await expect(withLock(home, 'home', () => Promise.resolve('ran'))).resolves.toBe('ran');
  });

  it('steal-claim mkdir EPERM — retry still wins the lock', async () => {
    expect.hasAssertions();
    const home = await seedStaleHomeLock();
    const fired = armClaimMkdirEperm();
    await expect(withLock(home, 'home', () => Promise.resolve('ran'))).resolves.toBe('ran');
    expect(fired()).toBe(true);
  });
});
