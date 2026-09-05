import type { LockMeta, MetaRead } from './lock-meta.ts';
import { isPidAlive, readLockMetaDetailed, readLockToken, statMtime } from './lock-meta.ts';
import { leaseMtimeMs, touchLeaseSidecar } from './lock-sidecar.ts';
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

// Everything one observation of a lock established. Deliberately a description rather than a
// verdict-plus-numbers: staleness, the "lock is held" error message, and `refs doctor` all read
// this, and they must never disagree about what they are looking at.
//
// Two distinctions matter and are easy to lose:
//
//   - **Which clock is running.** A renewable lock is judged from its last RENEWAL, not from when
//     it was acquired — it can be hours old and perfectly healthy. A lock with no usable sidecar is
//     judged from acquisition, against the longer legacy budget. One with no readable metadata at
//     all is judged from the directory's own mtime, against the short publication grace.
//   - **What liveness actually proves.** Only `ESRCH` establishes absence; every other probe result
//     — including a permission error, and including a pid that has since been reused by an
//     unrelated process — is "present, or unknown". Nothing here can say "that process is the
//     holder", and callers must not word it that way.
//   - **`none` means gone, never "could not tell".** A permissions fault is `unknown`: something is
//     there and nothing can be said about it, which is a finding rather than an absence. Collapsing
//     the two would let a locks directory nobody can stat report as an empty one.
type LockPolicy = 'grace' | 'lease' | 'legacy' | 'none' | 'unknown';

type LockDiagnosis = {
  /** Age against `policy`'s clock. Negative means the recorded time is in the future — clock skew,
   * not a fresh lock. Absent when no clock applies. */
  ageMs?: number;
  budgetMs?: number;
  meta: MetaRead['state'];
  observedAtMs: number;
  pid?: number;
  pidState: 'definitely-dead' | 'present-or-unknown' | 'unknown';
  policy: LockPolicy;
  /** Whether this lock is past its window or its owner is gone — i.e. whether it looks unhealthy.
   * NOT permission to take it: that is `isAutoReclaimable` below, which is strictly narrower.
   * `refs doctor` reports on this one; the steal path must not. */
  stale: boolean;
  /** This acquisition's ownership token, when its metadata carries a usable one. The steal path
   * re-reads it after proving the owner dead, which is what ties the death evidence to the
   * acquisition still occupying the path. */
  token?: string;
};

/** Diagnosis for a lock whose `meta.json` could not be read as valid metadata.
 *
 * The three reasons are not equivalent, and treating them alike is how an unreadable path becomes
 * a stolen lock:
 *
 *   - **`missing`** — no metadata has been published. The directory's own mtime stands in, against
 *     the short publication grace, so an acquisition still mid-publish is protected while a holder
 *     that died before publishing is reclaimable.
 *   - **`malformed`** — the file was read and its contents are not valid metadata. Judged the same
 *     way, and deliberately so: metadata is published atomically, so this means corruption, and a
 *     lock nobody can interpret must not block its ref forever.
 *   - **`unreadable`** — the file exists and could not be read at all (EACCES, EIO). That says
 *     nothing whatever about the holder, who may be alive and renewing, so it gets NO clock and is
 *     never stale. Sending it through the grace would let a five-second-old permissions fault hand
 *     a live holder's lock to a waiter — the same unsafe fallback avoided for the lease sidecar.
 *
 * A directory that is gone entirely yields no clock either, and is not stale: the next `mkdir`
 * simply succeeds. */
const diagnoseWithoutMeta = async (
  lockPath: string,
  state: Exclude<MetaRead['state'], 'valid'>,
  observedAtMs: number,
): Promise<LockDiagnosis> => {
  if (state === 'unreadable') {
    return { meta: state, observedAtMs, pidState: 'unknown', policy: 'unknown', stale: false };
  }
  const stamp = await statMtime(lockPath);
  if (stamp.state === 'gone') {
    return { meta: state, observedAtMs, pidState: 'unknown', policy: 'none', stale: false };
  }
  if (stamp.state === 'unreadable') {
    // Something occupies this path and nothing about it can be established. Never stale — stealing
    // on the strength of an unreadable path would be acting on ignorance — but it must not vanish
    // from a report either.
    return { meta: state, observedAtMs, pidState: 'unknown', policy: 'unknown', stale: false };
  }
  const ageMs = observedAtMs - stamp.mtimeMs;
  return {
    ageMs,
    budgetMs: MISSING_META_GRACE_MS,
    meta: state,
    observedAtMs,
    pidState: 'unknown',
    policy: 'grace',
    stale: ageMs > MISSING_META_GRACE_MS,
  };
};

/** Which window applies to a lock with valid metadata, and how long its clock has been running.
 * "Legacy" means "no usable sidecar for THIS acquisition" — which covers an unusable token, a
 * sidecar that was never created, and a sidecar belonging to a different acquisition alike. It is
 * not the same as "written by an old CLI", even though that is the common cause. */
const clockFor = async (
  lockPath: string,
  meta: LockMeta,
  observedAtMs: number,
): Promise<{ ageMs?: number; budgetMs?: number; policy: LockPolicy }> => {
  const lease =
    meta.token === undefined
      ? { state: 'absent' as const }
      : await leaseMtimeMs(lockPath, meta.token);
  if (lease.state === 'unreadable') {
    // A sidecar that exists but cannot be read says nothing about the lease. It must NOT fall
    // through to the legacy window, which is measured from acquisition and would mark a long-held
    // — but actively renewing — lock stale on the strength of an I/O fault.
    return { policy: 'unknown' };
  }
  if (lease.state === 'absent') {
    return {
      ageMs: observedAtMs - meta.acquiredAtMs,
      budgetMs: LEGACY_MAX_LOCK_AGE_MS,
      policy: 'legacy',
    };
  }
  return { ageMs: observedAtMs - lease.mtimeMs, budgetMs: LEASE_MS, policy: 'lease' };
};

/** One observation of one lock. Every age derives from a single captured `observedAtMs`, so the
 * parts of a diagnosis cannot disagree with each other about when "now" was. */
const diagnoseLock = async (lockPath: string, observedAtMs: number): Promise<LockDiagnosis> => {
  const read = await readLockMetaDetailed(lockPath);
  if (read.state !== 'valid') {
    return diagnoseWithoutMeta(lockPath, read.state, observedAtMs);
  }
  const { meta } = read;
  const clock = await clockFor(lockPath, meta, observedAtMs);
  // A process that is definitely gone is reclaimable immediately — there is nothing left to wait
  // out. The window below still applies to everyone else, regardless of liveness, which is what
  // keeps a recycled pid from holding a lock forever.
  const dead = !isPidAlive(meta.pid);
  // No clock means nothing could be established about the window — a live holder in that state is
  // never stale, because taking a lock on the strength of an unreadable path is acting on ignorance.
  const expired =
    clock.ageMs !== undefined && clock.budgetMs !== undefined && clock.ageMs > clock.budgetMs;
  return {
    ...clock,
    meta: 'valid',
    observedAtMs,
    pid: meta.pid,
    pidState: dead ? 'definitely-dead' : 'present-or-unknown',
    stale: dead || expired,
    ...(meta.token === undefined ? {} : { token: meta.token }),
  };
};

/** Whether a waiter may take this lock from its holder WITHOUT a human deciding.
 *
 * Strictly narrower than `stale`, and the difference is the whole of issue #70. `stale` is true
 * for a lock whose lease has run out even though its process is still answering — and a live
 * process can release at any instant, which is exactly what let a stealer rename away a lock that
 * had legitimately become someone else's in the meantime. Only `ESRCH` rules that out: a process
 * the OS does not know cannot run a release.
 *
 * A usable token is required too, because the steal path re-reads it after the death probe to
 * confirm the same acquisition is still there (`lock-steal.ts`). Metadata without one cannot be
 * tied to anything, so it is repaired by hand rather than reclaimed on a guess — as are the
 * missing/malformed and legacy-age grounds, which name no live-or-dead owner at all. */
const isAutoReclaimable = (diagnosis: LockDiagnosis): boolean =>
  diagnosis.meta === 'valid' &&
  diagnosis.pidState === 'definitely-dead' &&
  diagnosis.token !== undefined;

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

export {
  HEARTBEAT_MS,
  LEASE_MS,
  LEGACY_MAX_LOCK_AGE_MS,
  MISSING_META_GRACE_MS,
  diagnoseLock,
  isAutoReclaimable,
  renewLease,
};
export type { LockDiagnosis, LockPolicy };
