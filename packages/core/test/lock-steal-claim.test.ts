import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';
import { withLock } from '../src/lock.ts';

// A crashed stealer's leftover `.steal-claim` marker must not permanently block stealing of that
// lock name — `acquireStealClaim` reclaims a marker older than its stale threshold. Staged
// deterministically by aging the marker's mtime with `utimes`. In its own file because
// `lock.test.ts` has no headroom left under the repo's 300-line oxlint cap.

// Above macOS/Linux default pid_max, so it can never name a live process.
const DEAD_PID = 999_999;
// Comfortably past the implementation's 2s steal-claim stale threshold.
const AGED_CLAIM_MS = 10_000;

const makeHome = (): ReturnType<typeof resolveHome> => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-lock-claim-'));
  return resolveHome({ REFS_HOME: dir });
};

const seedStaleLockWithAgedClaim = (locksDir: string): string => {
  const lockPath = join(locksDir, 'home');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(lockPath, { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(
    join(lockPath, 'meta.json'),
    JSON.stringify({ acquired_at: new Date().toISOString(), pid: DEAD_PID, token: 'stale' }),
  );
  const claimPath = join(locksDir, 'home.steal-claim');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(claimPath);
  const agedDate = new Date(Date.now() - AGED_CLAIM_MS);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  utimesSync(claimPath, agedDate, agedDate);
  return claimPath;
};

describe('withLock stale steal-claim reclaim', () => {
  it('reclaims an abandoned steal-claim marker and still steals the stale lock', async () => {
    expect.hasAssertions();
    const home = makeHome();
    const claimPath = seedStaleLockWithAgedClaim(home.locksDir);

    const ran = await withLock(home, 'home', () => Promise.resolve('ran'));

    expect(ran).toBe('ran');
    // eslint-disable-next-line node/no-sync -- test assertion, sync is fine
    expect(existsSync(claimPath)).toBe(false);
  });
});
