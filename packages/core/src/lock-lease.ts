import {
  dirMtimeMs,
  isPidAlive,
  leaseMtimeMs,
  readLockMeta,
  readLockToken,
  touchLeaseSidecar,
} from './lock-meta.ts';
import type { LockMeta } from './lock-meta.ts';
import type { RenewOutcome } from './lock-heartbeat.ts';

// The lease POLICY behind `lock.ts`'s advisory lock: how long a stamped lease stays good, how often
// it is restamped, and what one renewal attempt does. The mechanism it rests on lives in
// `lock-meta.ts` (the per-acquisition sidecar) and `lock-heartbeat.ts` (the scheduler); keeping the
// numbers and their consumers here keeps `lock.ts` about acquire/wait/release alone. `isLockStale`
// is the single answer to "may this lock be taken from its holder?", shared by the wait loop and by
// the claim holder's re-diagnosis in `lock-steal.ts`, so the two can never disagree.

// How long a stamped lease stays valid without renewal. Renewed at a fraction of this, so a lock
// only expires after several consecutive renewals have failed to land.
//
// The assumption this rests on, stated rather than left implicit: a live holder's event loop runs
// at least once per lease. Anything that stops it for two minutes — process suspension, a machine
// sleeping, a pathologically long synchronous step — leaves a live holder stealable, and this
// window used to be the ten minutes below. That is a real narrowing, and it is accepted for three
// reasons: refs' own work is async subprocesses and fs calls, so a two-minute synchronous stall
// would itself be a bug; a sleeping machine suspends every refs process on it, not just the holder,
// so there is rarely anyone awake to do the stealing; and on resume the pending timer fires
// immediately, so the exposed window is the scheduling gap, not the sleep. Weighed against a
// crashed holder blocking a ref for ten minutes — the failure this replaces — the trade is worth
// making, but it IS a trade.
const LEASE_MS = 120_000;
// How often a holder re-stamps its lease. A quarter of `LEASE_MS`: short enough that transient fs
// failures get several retries inside one lease, long enough not to be fs churn.
const HEARTBEAT_MS = 30_000;
// Fallback budget for a lock carrying no lease sidecar — i.e. one written by a CLI version that
// never renews. Kept at the pre-lease value so such a holder is judged by exactly the rule it was
// written under, rather than being dispossessed early by a newer waiter. The reverse direction is
// not fixable from here and is accepted: an OLD waiter reads neither sidecar nor lease and will
// still dispossess a live new holder once `acquired_at` passes its own budget.
const LEGACY_MAX_LOCK_AGE_MS = 600_000;
// A dir with missing/corrupt meta.json is only stealable once older than this grace period — a
// freshly-created dir whose meta.json hasn't landed yet must NOT be stolen.
const MISSING_META_GRACE_MS = 5000;

/** Whether the holder's lease has run out. A lock with a sidecar for its own token is judged by
 * that sidecar's mtime against the short `LEASE_MS`; one without is a non-renewing holder and gets
 * `LEGACY_MAX_LOCK_AGE_MS` measured from `acquired_at`, the rule it was written under. */
const isLeaseExpired = async (lockPath: string, meta: LockMeta): Promise<boolean> => {
  const renewedAtMs =
    meta.token === undefined ? undefined : await leaseMtimeMs(lockPath, meta.token);
  if (renewedAtMs === undefined) {
    return Date.now() - meta.acquiredAtMs > LEGACY_MAX_LOCK_AGE_MS;
  }
  return Date.now() - renewedAtMs > LEASE_MS;
};

/** One heartbeat attempt: confirm the lock still carries our token, then stamp the lease. A token
 * that no longer matches — or a sidecar that is gone — is confirmed ownership loss. A transient fs
 * error from `touchLeaseSidecar` propagates instead, and the heartbeat retries it on the next tick;
 * the two are never conflated. */
const renewLease = async (lockPath: string, token: string): Promise<RenewOutcome> => {
  if ((await readLockToken(lockPath)) !== token) {
    return 'lost';
  }
  return (await touchLeaseSidecar(lockPath, token)) === 'gone' ? 'lost' : 'renewed';
};

const isLockStale = async (lockPath: string): Promise<boolean> => {
  const meta = await readLockMeta(lockPath);
  if (meta === undefined) {
    const mtimeMs = await dirMtimeMs(lockPath);
    if (mtimeMs === undefined) {
      // The dir vanished between EEXIST and this check — the holder released; the next mkdir
      // attempt will simply succeed, no steal needed.
      return false;
    }
    return Date.now() - mtimeMs > MISSING_META_GRACE_MS;
  }
  // Definitely gone (ESRCH — `isPidAlive` treats every other failure as alive) means abandoned
  // right now, with no need to wait out the lease. The lease check below then runs REGARDLESS of
  // liveness, so a live process holding an expired lease is still stale.
  if (!isPidAlive(meta.pid)) {
    return true;
  }
  return isLeaseExpired(lockPath, meta);
};

export { HEARTBEAT_MS, LEASE_MS, LEGACY_MAX_LOCK_AGE_MS, isLockStale, renewLease };
