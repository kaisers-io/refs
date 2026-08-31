import type { InspectedLock, LockDiagnosis, RefsHome } from '@kaisers-io/refs-core';
import { formatDuration, inspectLocks } from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';

// The `locks` check: what is currently in the refs home's locks directory, and whether any of it
// looks wrong. Read-only and lock-free — it observes a snapshot and changes nothing.
//
// This exists because a held lock used to be invisible: an acquisition failed with a message naming
// no owner, and `doctor` had no check for locks at all, so the one command meant to answer "is
// something stuck?" could not see the thing that was stuck.
//
// A lock being held is NOT a problem. It is what a concurrent `refs sync` looks like, so an
// ordinary held lock reports `ok` and is merely listed. Only something that will not resolve on its
// own is a `warn`.

const SEPARATOR = '; ';

/** Whether this observation is business as usual. A lock whose recorded process is gone will never
 * release itself; one past its window should already have been reclaimed and has not been; metadata
 * that is unreadable or malformed cannot be acted on at all; and a clock running backwards makes
 * every age here meaningless. Everything else — including a perfectly ordinary lock held by a live
 * process inside its window — is healthy. */
const isHealthy = (lock: InspectedLock): boolean => {
  const { diagnosis } = lock;
  if (diagnosis === undefined) {
    // A non-directory occupying a lock name blocks acquisition forever: nothing releases it,
    // because nothing holds it.
    return false;
  }
  if (diagnosis.pidState === 'definitely-dead' || diagnosis.stale) {
    return false;
  }
  if (diagnosis.meta === 'malformed' || diagnosis.meta === 'unreadable') {
    return false;
  }
  return diagnosis.ageMs === undefined || diagnosis.ageMs >= 0;
};

const clockPhrase = (diagnosis: LockDiagnosis): string => {
  const { ageMs, budgetMs } = diagnosis;
  if (ageMs === undefined || budgetMs === undefined) {
    return '';
  }
  if (ageMs < 0) {
    return ', recorded time is in the future — check the system clock';
  }
  return `, ${formatDuration(ageMs)} into a ${formatDuration(budgetMs)} window`;
};

const ownerPhrase = (diagnosis: LockDiagnosis): string => {
  if (diagnosis.pid === undefined) {
    return `owner unknown (metadata ${diagnosis.meta})`;
  }
  if (diagnosis.pidState === 'definitely-dead') {
    return `recorded pid ${diagnosis.pid} is not running`;
  }
  return `recorded pid ${diagnosis.pid} present`;
};

/** One line per observed entry. Says "recorded pid … present", never "held by pid …": only `ESRCH`
 * establishes absence, so a pid that answers may equally be an unrelated process that reused the
 * number. */
const lockLine = (lock: InspectedLock): string => {
  const { diagnosis } = lock;
  if (diagnosis === undefined) {
    return `${lock.name}: not a directory — this entry blocks acquisition and is not a lock`;
  }
  const reclaimable = diagnosis.stale ? ', reclaimable now' : '';
  return `${lock.name}: ${ownerPhrase(diagnosis)}${clockPhrase(diagnosis)}${reclaimable}`;
};

/** An unreadable locks directory is not reported here: `inspectLocks` lets that throw, and
 * `doctor`'s own step wrapper turns it into a `fail` for this check while every other check still
 * runs. A directory that cannot be listed is an operational fault, not an observation. */
const checkLocks = async (home: RefsHome): Promise<CheckResult> => {
  const locks = await inspectLocks(home);
  const [first] = locks;
  if (first === undefined) {
    return { detail: 'no locks held', name: 'locks', status: 'ok' };
  }
  const detail = locks.map((lock) => lockLine(lock)).join(SEPARATOR);
  const healthy = locks.every((lock) => isHealthy(lock));
  return { detail, name: 'locks', status: healthy ? 'ok' : 'warn' };
};

export { checkLocks };
