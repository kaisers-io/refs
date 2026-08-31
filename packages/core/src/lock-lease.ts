import type { LockMeta, MetaRead } from './lock-meta.ts';
import {
  dirMtimeMs,
  isPidAlive,
  leaseMtimeMs,
  readLockMetaDetailed,
  readLockToken,
  touchLeaseSidecar,
} from './lock-meta.ts';
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
type LockPolicy = 'grace' | 'lease' | 'legacy' | 'none';

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
  /** Whether a waiter may reclaim this lock now. Nothing reclaims it in the background: this only
   * says the next acquisition attempt is entitled to steal it. */
  stale: boolean;
};

/** Diagnosis for a lock whose `meta.json` could not be read as valid metadata. The directory's own
 * mtime stands in for the missing timestamp, against the short publication grace — a lock whose
 * metadata has not landed yet must not be stolen out from under an acquisition in progress. A
 * directory that is gone entirely yields no clock and is not stale: the next `mkdir` simply
 * succeeds. */
const diagnoseWithoutMeta = async (
  lockPath: string,
  state: Exclude<MetaRead['state'], 'valid'>,
  observedAtMs: number,
): Promise<LockDiagnosis> => {
  const mtimeMs = await dirMtimeMs(lockPath);
  if (mtimeMs === undefined) {
    return { meta: state, observedAtMs, pidState: 'unknown', policy: 'none', stale: false };
  }
  const ageMs = observedAtMs - mtimeMs;
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
): Promise<{ ageMs: number; budgetMs: number; policy: LockPolicy }> => {
  const renewedAtMs =
    meta.token === undefined ? undefined : await leaseMtimeMs(lockPath, meta.token);
  if (renewedAtMs === undefined) {
    return {
      ageMs: observedAtMs - meta.acquiredAtMs,
      budgetMs: LEGACY_MAX_LOCK_AGE_MS,
      policy: 'legacy',
    };
  }
  return { ageMs: observedAtMs - renewedAtMs, budgetMs: LEASE_MS, policy: 'lease' };
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
  return {
    ...clock,
    meta: 'valid',
    observedAtMs,
    pid: meta.pid,
    pidState: dead ? 'definitely-dead' : 'present-or-unknown',
    stale: dead || clock.ageMs > clock.budgetMs,
  };
};

const isLockStale = async (lockPath: string): Promise<boolean> => {
  const diagnosis = await diagnoseLock(lockPath, Date.now());
  return diagnosis.stale;
};

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Coarse, human-facing duration: `45s`, `2m 41s`, `1h 3m`. Precision below the largest two units
 * is noise in a message whose whole point is "roughly how long has this been going on". */
const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  // A trailing zero unit reads as noise in a sentence ("reclaimable 10m 0s from acquisition"), so
  // an exact hour or minute drops it.
  if (hours > 0) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  if (totalMinutes > 0) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

/** How the diagnosis may describe the recorded owner. Never says "the process is alive" or "held by
 * that process": only `ESRCH` establishes absence, so everything else is "present, or unknown", and
 * a reused pid is indistinguishable from the original holder. Saying more than that would be
 * confidently wrong exactly when someone is trying to work out whether to wait or intervene. */
const ownerPhrase = (diagnosis: LockDiagnosis): string => {
  if (diagnosis.pid === undefined) {
    return `owner unknown (metadata ${diagnosis.meta})`;
  }
  if (diagnosis.pidState === 'definitely-dead') {
    return `recorded pid ${diagnosis.pid} is not running`;
  }
  return `recorded pid ${diagnosis.pid} is present (identity not verified)`;
};

const POLICY_CLOCK: Record<LockPolicy, string> = {
  grace: 'created',
  lease: 'lease renewed',
  legacy: 'acquired',
  none: 'observed',
};

const POLICY_WINDOW: Record<LockPolicy, string> = {
  grace: 'from creation, while its metadata has not been published',
  lease: 'from the last renewal',
  legacy: 'from acquisition (no renewable lease)',
  none: '',
};

/** The "how long, and how much longer" half of the message. A future timestamp is called out rather
 * than rendered as a negative age — that is clock skew, not a fresh lock, and it changes what the
 * reader should do about it. */
const windowPhrase = (diagnosis: LockDiagnosis): string => {
  const { ageMs, budgetMs, policy } = diagnosis;
  if (ageMs === undefined || budgetMs === undefined) {
    return '';
  }
  if (ageMs < 0) {
    return `, but its recorded time is in the future — check the system clock`;
  }
  return `, ${POLICY_CLOCK[policy]} ${formatDuration(ageMs)} ago; reclaimable ${formatDuration(budgetMs)} ${POLICY_WINDOW[policy]}`;
};

/** The message a waiter reports when it gives up. Deliberately observational: nothing releases a
 * lock in the background, so it says "reclaimable" — meaning the NEXT acquisition attempt is
 * entitled to take it — and never "released automatically", which would promise a background
 * process that does not exist.
 *
 * A lock that is already reclaimable but still here is its own finding: reaching the timeout does
 * not prove the lock was healthy, it can equally mean the steal claim or the rename kept failing.
 * That case says so, because "wait a bit longer" would be the wrong advice for it. */
const describeHeldLock = (name: string, diagnosis: LockDiagnosis): string => {
  // Diagnosed after the timeout, so the lock may already be gone by the time it is described. That
  // is worth saying plainly: the advice for "it just got released" is simply to retry, and printing
  // an owner for a lock that no longer exists would send the reader after a ghost.
  if (diagnosis.policy === 'none') {
    return `lock ${name} could not be acquired before the timeout, but it was released while the failure was being diagnosed. Retry the operation.`;
  }
  const head = `lock ${name} is held: ${ownerPhrase(diagnosis)}`;
  if (diagnosis.stale) {
    return `${head}, and the lock is already reclaimable — refs could not reclaim it before the timeout. Retry; if it persists, run refs doctor.`;
  }
  return `${head}${windowPhrase(diagnosis)}. Retry once the other refs command finishes.`;
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

export {
  HEARTBEAT_MS,
  LEASE_MS,
  LEGACY_MAX_LOCK_AGE_MS,
  MISSING_META_GRACE_MS,
  describeHeldLock,
  diagnoseLock,
  formatDuration,
  isLockStale,
  renewLease,
};
export type { LockDiagnosis, LockPolicy };
