import {
  TOKEN_A,
  TOKEN_B,
  makeHome,
  writeLeaseSidecar,
  writeLockDir,
} from './helpers/lock-fixture.ts';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { EXIT } from '../src/errors.ts';
import { join } from 'node:path';
import { withLock } from '../src/lock.ts';

// Comfortably past the legacy 10-minute budget, which is what a lock carrying no lease sidecar is
// still judged by.
const STALE_AGE_MS = 660_000;
// Comfortably past the 2-minute lease, so a backdated sidecar reads as expired.
const EXPIRED_LEASE_AGE_MS = 180_000;
// Well inside the legacy budget but well past the lease — the age that tells the two policies
// apart in a single fixture.
const BETWEEN_POLICIES_AGE_MS = 180_000;
const FRESH_MS = 0;
// Short on purpose: where the lock must NOT be stolen, the deadline is the only way out.
const UNSTEALABLE_TIMEOUT_MS = 200;
const STEAL_TIMEOUT_MS = 2000;

// The lease is what issue #60 is about: a holder that is still working must keep its lock however
// long the work takes, while a holder that is gone must give it up quickly. Every fixture here
// backdates a sidecar's mtime rather than waiting, so the policy is pinned without real time.
describe('withLock lease vs acquisition age', () => {
  it('does not steal a live holder whose lease is fresh, however old the acquisition', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // `acquired_at` is far past the legacy budget — under the old fixed-age rule this lock was
    // stealable. It is not any more: the holder is alive and has renewed recently, which is exactly
    // the long-clone case that used to lose its lock mid-`reset --hard`.
    const lockPath = writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date(Date.now() - STALE_AGE_MS).toISOString(),
      pid: process.pid,
      token: TOKEN_A,
    });
    writeLeaseSidecar(lockPath, TOKEN_A, FRESH_MS);

    await expect(
      withLock(home, 'home', () => Promise.resolve(), {
        timeoutMs: UNSTEALABLE_TIMEOUT_MS,
      }),
    ).rejects.toMatchObject({ exitCode: EXIT.CONFLICT });
  });
});

describe('withLock expired lease', () => {
  it('steals a holder whose lease expired, even though its pid is alive', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // The mirror image: `acquired_at` is fresh, so only the expired lease can make this stale.
    // Together with the test above this pins that the LEASE decides, not the acquisition time.
    const lockPath = writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date().toISOString(),
      pid: process.pid,
      token: TOKEN_A,
    });
    writeLeaseSidecar(lockPath, TOKEN_A, EXPIRED_LEASE_AGE_MS);

    let ran = false;
    await withLock(
      home,
      'home',
      () => {
        ran = true;
        return Promise.resolve();
      },
      { timeoutMs: STEAL_TIMEOUT_MS },
    );

    expect(ran).toBe(true);
  });
});

describe('withLock legacy locks', () => {
  it('judges a lock with no lease sidecar by the legacy budget, not the short lease', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // No sidecar means the holder was written by a CLI that does not renew. Three minutes is past
    // the lease but well inside the legacy budget, so it must NOT be stolen — otherwise upgrading
    // would start dispossessing live holders that were running the previous version.
    writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date(Date.now() - BETWEEN_POLICIES_AGE_MS).toISOString(),
      pid: process.pid,
      token: TOKEN_A,
    });

    await expect(
      withLock(home, 'home', () => Promise.resolve(), {
        timeoutMs: UNSTEALABLE_TIMEOUT_MS,
      }),
    ).rejects.toMatchObject({ exitCode: EXIT.CONFLICT });
  });
});

describe('withLock sidecar identity', () => {
  it('ignores a lease sidecar belonging to a different acquisition', async () => {
    expect.hasAssertions();
    const home = makeHome();
    // A fresh sidecar is present, but it belongs to token B while the lock is held under token A —
    // the shape a delayed renewal from a previous, already-stolen holder would leave behind. It
    // must not extend A's lease, so A falls back to the legacy budget and is stale at this age.
    const lockPath = writeLockDir(home.locksDir, 'home', {
      acquired_at: new Date(Date.now() - STALE_AGE_MS).toISOString(),
      pid: process.pid,
      token: TOKEN_A,
    });
    writeLeaseSidecar(lockPath, TOKEN_B, FRESH_MS);

    let ran = false;
    await withLock(
      home,
      'home',
      () => {
        ran = true;
        return Promise.resolve();
      },
      { timeoutMs: STEAL_TIMEOUT_MS },
    );

    expect(ran).toBe(true);
  });
});

describe('withLock sidecar publication', () => {
  it('publishes exactly one lease sidecar for the acquisition it holds', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const lockPath = join(home.locksDir, 'home');

    let sidecars: string[] = [];
    await withLock(home, 'home', () => {
      // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
      sidecars = readdirSync(lockPath).filter((entry) => entry.startsWith('lease-'));
      return Promise.resolve();
    });

    expect(sidecars).toHaveLength(1);
  });
});

describe('withLock error precedence', () => {
  it("surfaces ownership loss as a conflict but lets the callback's own error win", async () => {
    expect.hasAssertions();
    const home = makeHome();
    const metaPath = join(home.locksDir, 'home', 'meta.json');

    const held = withLock(home, 'home', () => {
      // Same simulated theft as the release-ownership suite, but the callback also fails. The
      // caller must see the REAL failure, not a lock-level complaint layered over it.
      // eslint-disable-next-line node/no-sync -- test simulates a concurrent steal mid-hold
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
      meta['token'] = TOKEN_B;
      // eslint-disable-next-line node/no-sync -- test simulates a concurrent steal mid-hold
      writeFileSync(metaPath, JSON.stringify(meta));
      return Promise.reject(new Error('the actual work failed'));
    });

    await expect(held).rejects.toThrow('the actual work failed');

    // eslint-disable-next-line node/no-sync -- test cleanup, sync is fine
    rmSync(join(home.locksDir, 'home'), { force: true, recursive: true });
  });
});
