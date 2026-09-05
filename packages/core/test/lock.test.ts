import { DEAD_PID, TOKEN_A, makeHome, writeLockDir } from './helpers/lock-fixture.ts';
import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { EXIT } from '../src/errors.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { withLock } from '../src/lock.ts';

const HOLD_MS = 50;
// Comfortably past the legacy 10-minute budget, which is what a lock carrying no lease sidecar is
// still judged by.
const STALE_AGE_MS = 660_000;
// Far enough ahead that `isClaimStale`'s `Date.now() - mtime` can never reach its window.
const CLAIM_FUTURE_MTIME_MS = 3_600_000;
// Short on purpose: with the claim unreclaimable, the deadline is the only way out.
const STALE_UNSTEALABLE_TIMEOUT_MS = 200;

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
  it('refuses to steal an age-stale lock whose pid is alive, and times out instead', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // `pid` is this very test process — alive — so only the age check could make this stealable.
    // It no longer does: a live process can release at any instant, and a release is what lets the
    // path become somebody else's lock underneath a stealer (#70).
    writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date(Date.now() - STALE_AGE_MS).toISOString(),
      pid: process.pid,
      token: TOKEN_A,
    });

    let ran = false;
    const attempt = withLock(
      home,
      'home',
      () => {
        ran = true;
        return Promise.resolve();
      },
      { timeoutMs: 300 },
    );

    await expect(attempt).rejects.toThrow('is held');
    expect(ran).toBe(false);
  });
});

describe('withLock locks it will take', () => {
  it('steals a lock whose recorded pid is gone and whose identity still matches', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // `acquired_at` is "now" — only the dead-pid ground can make this stealable, which is the one
    // ground that survives: a process the OS does not know cannot run a release.
    writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date().toISOString(),
      pid: DEAD_PID,
      token: TOKEN_A,
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

describe('withLock locks it will not take', () => {
  it('refuses to steal a dead holder whose metadata carries no token', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // Written by a CLI old enough to predate ownership tokens. The owner is provably gone, but
    // there is nothing to re-identify the acquisition by after the death probe, so the steal has
    // no fence to stand on and refs leaves it for `refs doctor` and a human.
    writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date(Date.now() - STALE_AGE_MS).toISOString(),
      pid: DEAD_PID,
    });

    const attempt = withLock(home, 'home', () => Promise.resolve(), { timeoutMs: 300 });

    await expect(attempt).rejects.toThrow('is held');
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
      // The message has to be usable, not just correct: it names the recorded owner, how long the
      // lock has been held, and when it becomes reclaimable — without claiming the recorded pid IS
      // the holder, which nothing here can establish. Seeded without a token, so this is a lock
      // under the legacy window.
      await expect(attempt).rejects.toThrow(
        `recorded pid ${process.pid} is present (identity not verified)`,
      );
      await expect(attempt).rejects.toThrow('reclaimable 10m from acquisition');
      await expect(attempt).rejects.toMatchObject({ code: 'conflict', exitCode: EXIT.CONFLICT });
    } finally {
      // eslint-disable-next-line node/no-sync -- test cleanup, sync is fine
      rmSync(lockPath, { force: true, recursive: true });
    }
  });
});

// Regression: `stealOrWait` used to return from the stale branch without consulting the deadline,
// so a lock that diagnosed stale but could not actually be stolen spun without bound and the
// documented `timeoutMs` never applied. Seeded here by holding the steal claim: every attempt sees
// a stealable lock, none of them may remove it. Against the pre-fix code this test does not fail
// on an assertion — it hangs.
describe('withLock timeout on an unstealable stale lock', () => {
  it('times out with a conflictError when a stale lock cannot be stolen', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // Stale by the dead-pid rule, so each attempt diagnoses it as stealable.
    writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date().toISOString(),
      pid: DEAD_PID,
    });
    // A steal claim nobody releases, so no attempt ever gets to remove the lock. Its mtime is
    // dated into the future rather than left at "now": `isClaimStale` asks whether
    // `Date.now() - mtime` exceeds its 2s window, so a future mtime can never satisfy it. Relying
    // on the claim merely being *recent* would make this test wall-clock dependent — the steal
    // attempt runs before the deadline check, so a single late-firing retry timer on a stalled
    // runner would land on a claim that had aged out, reclaim it, and see the callback run. That
    // is the exact failure this test exists to detect, and this repo's own CI has stretched a 1.2s
    // suite past 10s. Future-dating removes the dependency instead of betting against it.
    const claimPath = join(home.locksDir, 'home.steal-claim');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(claimPath, { recursive: true });
    const farFuture = new Date(Date.now() + CLAIM_FUTURE_MTIME_MS);
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    utimesSync(claimPath, farFuture, farFuture);

    const attempt = withLock(home, 'home', () => Promise.resolve('unreachable'), {
      timeoutMs: STALE_UNSTEALABLE_TIMEOUT_MS,
    });

    await expect(attempt).rejects.toMatchObject({ code: 'conflict', exitCode: EXIT.CONFLICT });
  });
});

describe('withLock release ownership', () => {
  it('rejects and leaves the foreign lock alone when its token was stolen mid-hold', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const lockPath = join(home.locksDir, 'home');
    const metaPath = join(lockPath, 'meta.json');

    let sawSimulatedTheft = false;
    const held = withLock(home, 'home', () => {
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

    // The callback ran without the mutual exclusion it asked for, so its success is not
    // trustworthy — release detects the foreign token and reports it rather than staying silent.
    // A theft can land after the last heartbeat, so release is the backstop the heartbeat cannot be.
    await expect(held).rejects.toThrow(/was lost while the operation was running/u);
    expect(sawSimulatedTheft).toBe(true);
    // Release must still have refused to REMOVE the (now-foreign) lock dir, since the token no
    // longer matched this acquisition's token.
    // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
    expect([existsSync(lockPath), existsSync(metaPath)]).toStrictEqual([true, true]);

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
