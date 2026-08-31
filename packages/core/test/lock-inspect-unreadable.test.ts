import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { inspectLocks } from '../src/lock-inspect.ts';
import { join } from 'node:path';
import { resolveHome } from '../src/home.ts';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// A locks directory that lists but cannot be searched — `readdir` succeeds, `stat` on its children
// fails with EACCES — is a real configuration (a directory with the read bit but not the execute
// bit). It must never read as an EMPTY locks directory: "no locks held" from a check that could not
// look is the worst answer a diagnostic can give, because it is indistinguishable from good news.
//
// `stat` is mocked rather than provoked with `chmod`, which behaves differently on Windows, where
// this suite also runs.

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  // `stat` is overloaded (its return type depends on `bigint`), and vi.fn's inferred mock type
  // cannot reproduce every overload — cast back to the original signature, as
  // `lock-steal-eperm.test.ts` does for `mkdir`.
  const statSpy = vi.fn<typeof actual.stat>(actual.stat as never) as unknown as typeof actual.stat;
  return { ...actual, stat: statSpy };
});

const ELEVEN_MINUTES_MS = 660_000;
const TOKEN = '11111111-2222-4333-8444-555555555555';

/** A lock directory carrying valid metadata plus a lease sidecar, acquired long enough ago that
 * the legacy window would call it stale. Returns the home it lives in. */
const seedRenewableLock = (): ReturnType<typeof resolveHome> => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-lock-sidecar-'));
  const home = resolveHome({ REFS_HOME: dir });
  const lockPath = join(home.locksDir, 'home');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(lockPath, { recursive: true });
  const meta = {
    acquired_at: new Date(Date.now() - ELEVEN_MINUTES_MS).toISOString(),
    pid: process.pid,
    token: TOKEN,
  };
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(lockPath, 'meta.json'), JSON.stringify(meta));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(lockPath, `lease-${TOKEN}`), '');
  return home;
};

const eaccesError = (): NodeJS.ErrnoException => {
  const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
  error.code = 'EACCES';
  return error;
};

describe('inspectLocks on an unreadable lease sidecar', () => {
  it('does not fall back to the legacy window, which could steal a live holder', async () => {
    expect.hasAssertions();
    // Acquired well past the legacy window: if an unreadable sidecar fell through to that window,
    // this lock would read as stale and a waiter would take it from a holder that is alive and
    // renewing. That is the dispossession the lease exists to prevent, reached from the other side.
    const home = seedRenewableLock();
    vi.mocked(stat).mockRejectedValueOnce(eaccesError());

    const locks = await inspectLocks(home);

    expect(locks[0]?.diagnosis).toMatchObject({ policy: 'unknown', stale: false });
  });
});

describe('inspectLocks on an unsearchable locks directory', () => {
  it('reports the entry as unknown rather than dropping it as gone', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const dir = mkdtempSync(join(tmpdir(), 'refs-lock-eacces-'));
    const home = resolveHome({ REFS_HOME: dir });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(home.locksDir, 'home'), { recursive: true });
    // The directory lists fine; stat'ing into it does not. No `meta.json` is written, so metadata
    // reads as `missing` and the directory's own mtime is the only thing left to judge by — which
    // is exactly the read that fails here.
    vi.mocked(stat).mockRejectedValueOnce(eaccesError());

    const locks = await inspectLocks(home);

    // `gone` and `could not tell` both yield no timestamp, but only the first means "nothing is
    // here". Collapsing them is what would turn a permissions fault into a clean bill of health.
    expect(locks).toHaveLength(1);
    expect(locks[0]?.diagnosis).toMatchObject({
      meta: 'missing',
      policy: 'unknown',
      // Never stale: stealing a lock on the strength of a path nobody can read would be acting on
      // ignorance.
      stale: false,
    });
  });
});
