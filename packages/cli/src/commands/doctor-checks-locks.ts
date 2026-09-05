import {
  CLAIMS_DIRNAME,
  formatDuration,
  inspectLocks,
  isAutoReclaimable,
} from '@kaisers-io/refs-core';
import type { InspectedLock, LockDiagnosis, RefsHome } from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import { join } from 'node:path';
import { rmdirCommand } from '../shell-quote.ts';

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
 * process inside its window — is healthy.
 *
 * A steal claim is never healthy in that sense: it is either part of a steal happening right now,
 * which is over in a few filesystem calls, or it is left over from a stealer that died — and
 * nothing observable tells those apart. Surfacing it is the point; deciding is the reader's. */
const isHealthy = (lock: InspectedLock): boolean => {
  const { diagnosis } = lock;
  if (lock.kind === 'claim' || !lock.isDirectory) {
    // It resolves on its own once the metadata grace elapses, but nothing legitimate ever puts a
    // file where a lock belongs — worth a look even though it is not permanent.
    return false;
  }
  if (diagnosis.pidState === 'definitely-dead' || diagnosis.stale) {
    return false;
  }
  if (diagnosis.meta === 'malformed' || diagnosis.meta === 'unreadable') {
    return false;
  }
  if (diagnosis.policy === 'unknown') {
    // Nothing could be established about this entry. Reporting it `ok` would be the one failure
    // this check exists to avoid: a clean bill of health from a look that did not happen.
    return false;
  }
  return diagnosis.ageMs === undefined || diagnosis.ageMs >= 0;
};

const clockPhrase = (diagnosis: LockDiagnosis): string => {
  const { ageMs, budgetMs, policy } = diagnosis;
  if (policy === 'unknown') {
    return ', state could not be read';
  }
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

/** What a claim's presence means, and the one command that clears it. Deliberately does NOT say
 * the stealer crashed: age is not evidence of abandonment, which is exactly why claims stopped
 * being reclaimed by age. `rmdir` rather than a recursive remove, because a claim is always an
 * empty directory — if something else is at that path, the command failing is the right outcome. */
const claimLine = (home: RefsHome, lock: InspectedLock): string => {
  const path = join(home.locksDir, CLAIMS_DIRNAME, lock.name);
  const age =
    lock.diagnosis.ageMs === undefined ? '' : ` for ${formatDuration(lock.diagnosis.ageMs)}`;
  return (
    `steal claim on ${lock.name}: present${age}. Stealing this lock is blocked while it is here. ` +
    `A steal in progress clears it within a moment; if it stays, stop every refs process using ` +
    `this home — including suspended ones — and then run: ${rmdirCommand(path)}`
  );
};

/** One line per observed lock. Says "recorded pid … present", never "held by pid …": only `ESRCH`
 * establishes absence, so a pid that answers may equally be an unrelated process that reused the
 * number. */
const reclaimPhrase = (diagnosis: LockDiagnosis): string => {
  if (isAutoReclaimable(diagnosis)) {
    return ', reclaimable now';
  }
  return diagnosis.stale
    ? ', past its window but not automatically reclaimable — see refs doctor'
    : '';
};

const lockLine = (lock: InspectedLock): string => {
  const { diagnosis } = lock;
  // Named, but not overstated: a non-directory does block `mkdir`, yet it is reclaimed on the same
  // terms as any entry whose metadata never landed. Saying it blocks acquisition outright would
  // send someone deleting files by hand for a condition that clears itself.
  const kind = lock.isDirectory ? '' : 'not a directory, ';
  // Two different facts, and collapsing them is how a lock nobody will ever reclaim reads as one
  // that is about to be. `stale` says the window has run out; only `isAutoReclaimable` says refs
  // will act on it without being asked.
  const reclaimable = reclaimPhrase(diagnosis);
  return `${lock.name}: ${kind}${ownerPhrase(diagnosis)}${clockPhrase(diagnosis)}${reclaimable}`;
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
  const detail = locks
    .map((lock) => (lock.kind === 'claim' ? claimLine(home, lock) : lockLine(lock)))
    .join(SEPARATOR);
  const healthy = locks.every((lock) => isHealthy(lock));
  return { detail, name: 'locks', status: healthy ? 'ok' : 'warn' };
};

export { checkLocks };
