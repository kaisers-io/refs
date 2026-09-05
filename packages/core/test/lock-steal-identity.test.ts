import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { isAutoReclaimable } from '../src/lock-lease.ts';
import { isPidAlive } from '../src/lock-meta.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';
import { withLock } from '../src/lock.ts';

// Issue #70, staged at the exact instruction where it happens.
//
// `diagnoseLock` reads `meta.json` and THEN probes the recorded pid — two observations with an
// await between them. In that window the owner can release and exit while a waiter takes the same
// path. The probe then answers for the departed owner, the diagnosis says "abandoned", and the
// rename deletes a lock somebody is actively using.
//
// Proving a holder dead is not enough to rule that out, and this is the test that says so: the
// pid probe here reports death, truthfully, about a process that really is gone — while the path
// already belongs to somebody else. Only re-reading the acquisition identity AFTER the death
// verdict catches it.
//
// The seam is `isPidAlive`. Replacing the lock's metadata from inside the probe reproduces the
// interleaving deterministically, where a sleep would only reproduce it sometimes.

vi.mock(import('../src/lock-meta.ts'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isPidAlive: vi.fn<typeof actual.isPidAlive>(actual.isPidAlive) };
});

const DEAD_PID = 2_147_483_647;
const DEPARTED_TOKEN = '11111111-2222-4333-8444-555555555555';
const SUCCESSOR_TOKEN = '99999999-8888-4777-8666-555555555555';
// Short: the point of every case here is that the steal must NOT happen, and the deadline is the
// only way out of the retry loop.
const SHORT_TIMEOUT_MS = 300;

const makeHome = (): ReturnType<typeof resolveHome> => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-lock-identity-'));
  return resolveHome({ REFS_HOME: dir });
};

const writeMeta = (metaPath: string, pid: number, token: string): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(metaPath, JSON.stringify({ acquired_at: new Date().toISOString(), pid, token }));
};

/** A lock held by a process that has genuinely departed — the one shape a steal may act on. */
const seedDepartedLock = (locksDir: string): string => {
  const lockPath = join(locksDir, 'home');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(lockPath, { recursive: true });
  const metaPath = join(lockPath, 'meta.json');
  writeMeta(metaPath, DEAD_PID, DEPARTED_TOKEN);
  return metaPath;
};

describe('steal identity fence', () => {
  it('will not delete a lock that changed hands between the metadata read and the pid probe', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const metaPath = seedDepartedLock(home.locksDir);

    // The interleaving, exactly: the departed owner's release and a waiter's acquisition both
    // land while the probe is in flight. `false` is the truth about the pid that was read — and
    // acting on it would delete the live successor now occupying the path.
    vi.mocked(isPidAlive).mockImplementationOnce(() => {
      writeMeta(metaPath, process.pid, SUCCESSOR_TOKEN);
      return false;
    });

    const attempt = withLock(home, 'home', () => Promise.resolve('ran'), {
      timeoutMs: SHORT_TIMEOUT_MS,
    });

    await expect(attempt).rejects.toThrow('is held');
  });

  it('leaves the successor exactly as it found it', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const metaPath = seedDepartedLock(home.locksDir);
    vi.mocked(isPidAlive).mockImplementationOnce(() => {
      writeMeta(metaPath, process.pid, SUCCESSOR_TOKEN);
      return false;
    });

    await expect(
      withLock(home, 'home', () => Promise.resolve(), { timeoutMs: SHORT_TIMEOUT_MS }),
    ).rejects.toThrow('is held');

    // The failure above is only half the property. The other half is that the lock survived: a
    // steal that refuses but has already renamed the directory away has still lost the successor
    // its lock.
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { token: string };
    expect(meta.token).toBe(SUCCESSOR_TOKEN);
  });
});

describe('what may be reclaimed automatically', () => {
  it('permits a steal only when the owner is proven gone and the acquisition is identifiable', () => {
    expect.hasAssertions();
    const base = { meta: 'valid' as const, observedAtMs: 0, policy: 'lease' as const, stale: true };

    // The one shape that may be taken automatically.
    expect(isAutoReclaimable({ ...base, pidState: 'definitely-dead', token: DEPARTED_TOKEN })).toBe(
      true,
    );
    // Alive, or merely unprovable — a process that answers may release at any instant.
    expect(
      isAutoReclaimable({ ...base, pidState: 'present-or-unknown', token: DEPARTED_TOKEN }),
    ).toBe(false);
    expect(isAutoReclaimable({ ...base, pidState: 'unknown', token: DEPARTED_TOKEN })).toBe(false);
    // Dead, but nothing to re-identify the acquisition by after the death probe.
    expect(isAutoReclaimable({ ...base, pidState: 'definitely-dead' })).toBe(false);
    // No usable metadata at all: the grace and legacy grounds name no owner, live or dead.
    expect(
      isAutoReclaimable({
        ...base,
        meta: 'missing',
        pidState: 'unknown',
        policy: 'grace',
      }),
    ).toBe(false);
  });
});

describe('steal error precedence', () => {
  it('lets a failure inside the steal escape rather than reporting it as no-steal', async () => {
    expect.hasAssertions();
    const home = makeHome();
    seedDepartedLock(home.locksDir);
    const boom = new Error('probe exploded');
    vi.mocked(isPidAlive).mockImplementationOnce(() => {
      throw boom;
    });

    // The claim cleanup runs either way, and it must not swallow this or replace it with a bland
    // "nothing was stolen" — a fault inside the steal is a fault, not a lost race.
    await expect(
      withLock(home, 'home', () => Promise.resolve(), { timeoutMs: SHORT_TIMEOUT_MS }),
    ).rejects.toThrow('probe exploded');
  });
});
