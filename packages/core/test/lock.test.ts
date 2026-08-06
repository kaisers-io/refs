import { DEAD_PID, makeHome, writeLockDir } from './helpers/lock-fixture.ts';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { EXIT } from '../src/errors.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { withLock } from '../src/lock.ts';

const HOLD_MS = 50;
// Comfortably past the implementation's 10-minute stale threshold.
const STALE_AGE_MS = 660_000;

// Recursive, sorted snapshot of everything under `root` — used to prove a rejected `withLock`
// Call never touched the filesystem.
const snapshotTree = (root: string): string[] => {
  // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
  if (!existsSync(root)) {
    return [];
  }
  // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
  return readdirSync(root, { recursive: true })
    .map(String)
    .toSorted((left, right) => left.localeCompare(right));
};

describe('withLock serialization', () => {
  it('serializes two concurrent calls on the same lock name', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const order: string[] = [];

    const task = (label: string): Promise<void> =>
      withLock(home, 'home', async () => {
        order.push(`${label}-enter`);
        await delay(HOLD_MS);
        order.push(`${label}-exit`);
      });

    await Promise.all([task('a'), task('b')]);

    // No interleaving: whoever enters first must exit before the other enters. Either overall
    // Order is legal, but enter/exit pairs must never overlap.
    expect(['a-enter,a-exit,b-enter,b-exit', 'b-enter,b-exit,a-enter,a-exit']).toContain(
      order.join(','),
    );
  });

  it('releases the lock after fn throws so a subsequent call can acquire it promptly', async () => {
    expect.hasAssertions();
    const home = makeHome();

    await expect(withLock(home, 'home', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    const order: string[] = [];
    await withLock(
      home,
      'home',
      () => {
        order.push('acquired');
        return Promise.resolve();
      },
      { timeoutMs: 1000 },
    );
    expect(order).toStrictEqual(['acquired']);
  });
});

describe('withLock stale locks', () => {
  it('steals an age-stale lock (old timestamp, alive pid) and acquires within the timeout', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // `pid` is this very test process — alive — so only the age check can make this stale.
    writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date(Date.now() - STALE_AGE_MS).toISOString(),
      pid: process.pid,
    });

    let ran = false;
    await withLock(
      home,
      'home',
      () => {
        ran = true;
        return Promise.resolve();
      },
      { timeoutMs: 2000 },
    );

    expect(ran).toBe(true);
  });

  it('steals a dead-pid-stale lock (fresh timestamp, dead pid) and acquires within the timeout', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // `acquired_at` is "now" — only the dead-pid check can make this stale.
    writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date().toISOString(),
      pid: DEAD_PID,
    });

    let ran = false;
    await withLock(
      home,
      'home',
      () => {
        ran = true;
        return Promise.resolve();
      },
      { timeoutMs: 2000 },
    );

    expect(ran).toBe(true);
  });
});

describe('withLock timeout', () => {
  it('times out with a conflictError when the lock is held by a live, fresh process', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const lockPath = writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date().toISOString(),
      pid: process.pid,
    });

    try {
      const attempt = withLock(home, 'home', () => Promise.resolve('unreachable'), {
        timeoutMs: 300,
      });
      await expect(attempt).rejects.toThrow('lock home is held — another refs process is running');
      await expect(attempt).rejects.toMatchObject({ code: 'conflict', exitCode: EXIT.CONFLICT });
    } finally {
      // eslint-disable-next-line node/no-sync -- test cleanup, sync is fine
      rmSync(lockPath, { force: true, recursive: true });
    }
  });
});

describe('withLock release ownership', () => {
  it('does not remove the lock on release when its token was stolen mid-hold', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const lockPath = join(home.locksDir, 'home');
    const metaPath = join(lockPath, 'meta.json');

    let sawSimulatedTheft = false;
    await withLock(home, 'home', () => {
      // Simulate a concurrent steal: another process renamed our lock away, rm'd the tombstone,
      // Re-mkdir'd fresh, and wrote its own token — all while we still (wrongly) think we hold it.
      // eslint-disable-next-line node/no-sync -- test simulates a concurrent steal mid-hold
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
      meta['token'] = 'someone-else-now-owns-this-lock';
      // eslint-disable-next-line node/no-sync -- test simulates a concurrent steal mid-hold
      writeFileSync(metaPath, JSON.stringify(meta));
      sawSimulatedTheft = true;
      return Promise.resolve();
    });

    expect(sawSimulatedTheft).toBe(true);
    // Release must have refused to remove the (now-foreign) lock dir since the token no longer
    // Matched this acquisition's token.
    // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
    expect(existsSync(lockPath)).toBe(true);
    // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
    expect(existsSync(metaPath)).toBe(true);

    // Manual cleanup — our fake "new holder" never releases on its own.
    // eslint-disable-next-line node/no-sync -- test cleanup, sync is fine
    rmSync(lockPath, { force: true, recursive: true });
  });
});

describe('withLock name validation', () => {
  it('rejects lock names containing a slash', async () => {
    expect.hasAssertions();
    const home = makeHome();
    await expect(
      withLock(home, 'ref:github.com/owner/repo', () => Promise.resolve('unreachable')),
    ).rejects.toThrow(/must not contain/u);
  });

  it('rejects lock names containing ":" (not a legal character in Windows file names)', async () => {
    expect.hasAssertions();
    const home = makeHome();
    await expect(
      withLock(home, 'ref:github.com_owner_repo', () => Promise.resolve('unreachable')),
    ).rejects.toThrow(/must not contain/u);
  });

  it.each([['.'], ['..'], ['a/../b']])(
    'rejects %j without touching the filesystem',
    async (name) => {
      expect.hasAssertions();
      const home = makeHome();
      const before = snapshotTree(home.root);

      await expect(
        withLock(home, name, () => Promise.resolve('unreachable')),
      ).rejects.toMatchObject({ code: 'validation', exitCode: EXIT.VALIDATION });

      expect(snapshotTree(home.root)).toStrictEqual(before);
    },
  );
});
