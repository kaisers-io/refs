import type { LockDiagnosis, LockPolicy } from './lock-lease.ts';

// How a lock observation reads to a human. Split out of `lock-lease.ts`, which owns the policy —
// what a lock's window is and when it may be taken — so that file stays about the decision and
// this one about the sentence. They share `LockDiagnosis`, so a message can never describe
// something the policy did not establish.

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
  unknown: 'observed',
};

const POLICY_WINDOW: Record<LockPolicy, string> = {
  grace: 'from creation, while its metadata has not been published',
  lease: 'from the last renewal',
  legacy: 'from acquisition (no renewable lease)',
  none: '',
  unknown: '',
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

export { describeHeldLock, formatDuration };
