import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { CLAIMS_DIRNAME } from '../src/lock-steal.ts';
import { join } from 'node:path';
import { once } from 'node:events';
import { resolveHome } from '../src/home.ts';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { withLock } from '../src/lock.ts';

// A steal claim excludes every other stealer, and it does so by never expiring. It used to be
// reclaimed once its directory mtime passed two seconds, which meant it excluded only a stealer
// fast enough to finish inside that window: a suspended one lost its claim mid-work, another took
// it, and the two then raced the same lock — the interleaving that made "only steal from a dead
// holder" insufficient on its own (#70).
//
// So an aged claim is no longer evidence of anything. These tests pin the trade that buys: a claim
// left by a crashed stealer blocks stealing of that ONE lock name until a human removes it, and
// blocks nothing else. In its own file because `lock.test.ts` has no headroom left under the
// repo's 300-line oxlint cap.

// Far past the two seconds that used to make a claim reclaimable, so a test that still passes is
// asserting the new rule rather than being fast enough to dodge the old one.
const AGED_CLAIM_MS = 10_000;
const SHORT_TIMEOUT_MS = 300;

/** Spawns a trivial child and waits for it to exit — a pid KNOWN to be dead, unlike a hardcoded
 * large pid, which modern Linux (`kernel.pid_max` up to 4194304) can legitimately hand to a live
 * process. Mirrors `lock-meta.test.ts`'s helper. */
const exitedChildPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ['--version'], { stdio: 'ignore' });
  const { pid } = child;
  if (pid === undefined) {
    throw new Error('test setup: child failed to spawn');
  }
  await once(child, 'exit');
  return pid;
};

const makeHome = (): ReturnType<typeof resolveHome> => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-lock-claim-'));
  return resolveHome({ REFS_HOME: dir });
};

/** A lock whose owner is provably gone — the one shape that IS automatically stealable. */
const seedDeadLock = (locksDir: string, deadPid: number): void => {
  const lockPath = join(locksDir, 'home');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(lockPath, { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(
    join(lockPath, 'meta.json'),
    JSON.stringify({
      acquired_at: new Date().toISOString(),
      pid: deadPid,
      token: '11111111-2222-4333-8444-555555555555',
    }),
  );
};

/** A claim marker for `home`, backdated well past the threshold that used to reclaim it. */
const seedAgedClaim = (locksDir: string): string => {
  const claimPath = join(locksDir, CLAIMS_DIRNAME, 'home');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(claimPath, { recursive: true });
  const agedDate = new Date(Date.now() - AGED_CLAIM_MS);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  utimesSync(claimPath, agedDate, agedDate);
  return claimPath;
};

describe('steal claims do not expire', () => {
  it('leaves an aged claim in place and refuses to steal the lock behind it', async () => {
    expect.hasAssertions();
    const home = makeHome();
    seedDeadLock(home.locksDir, await exitedChildPid());
    const claimPath = seedAgedClaim(home.locksDir);

    const attempt = withLock(home, 'home', () => Promise.resolve('ran'), {
      timeoutMs: SHORT_TIMEOUT_MS,
    });

    // The lock itself is perfectly stealable — dead owner, matching identity. The claim is the
    // only thing standing in the way, and age does not move it.
    await expect(attempt).rejects.toThrow('is held');
    // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
    expect(existsSync(claimPath)).toBe(true);
  });

  it('blocks only that one lock name, never ordinary acquisition of another', async () => {
    expect.hasAssertions();
    const home = makeHome();
    seedAgedClaim(home.locksDir);

    // Nothing holds `other`, and a claim on `home` says nothing about it.
    const ran = await withLock(home, 'other', () => Promise.resolve('ran'), {
      timeoutMs: SHORT_TIMEOUT_MS,
    });

    expect(ran).toBe('ran');
  });

  it('removes its own claim once the steal is done', async () => {
    expect.hasAssertions();
    const home = makeHome();
    seedDeadLock(home.locksDir, await exitedChildPid());

    const ran = await withLock(home, 'home', () => Promise.resolve('ran'));

    expect(ran).toBe('ran');
    // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
    expect(existsSync(join(home.locksDir, CLAIMS_DIRNAME, 'home'))).toBe(false);
  });
});
