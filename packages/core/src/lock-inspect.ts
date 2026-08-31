import type { LockDiagnosis } from './lock-lease.ts';
import type { RefsHome } from './home.ts';
import { diagnoseLock } from './lock-lease.ts';
import { isEnoent } from './fs-atomic.ts';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

// Read-only enumeration of what is currently in the locks directory, for `refs doctor`. Takes no
// lock of its own: it observes, changes nothing, and there is no tree that could be reset
// underneath it. Every verdict comes from `diagnoseLock`, so what doctor reports and what a waiter
// decides can never drift apart.

// The two protocol artifacts `lock-steal.ts` leaves in the same directory. A claim is normal for a
// few filesystem operations and self-reclaims after two seconds; a tombstone is the transient name
// a lock is renamed to just before removal. Reporting either as a held lock would make the check
// flap on perfectly healthy concurrent activity, so both are filtered out. (Tombstones that
// genuinely accumulate are worth surfacing one day, but as their own leak diagnostic — they are
// not held locks, and a single in-flight one must never colour this check.)
const CLAIM_SUFFIX = '.steal-claim';
const TOMBSTONE_PATTERN = /\.steal\.[0-9a-f-]+$/u;

const isProtocolArtifact = (name: string): boolean =>
  name.endsWith(CLAIM_SUFFIX) || TOMBSTONE_PATTERN.test(name);

type InspectedLock = {
  /** Absent when `entry` is not a directory: there is no metadata to diagnose. */
  diagnosis?: LockDiagnosis;
  /** `'blocking-entry'` is a lock name occupied by something that is not a directory. It has no
   * holder and no metadata, but it fails `mkdir` exactly like a held lock does, so an acquisition
   * waits out its full timeout against something that will never be released. Worth naming. */
  entry: 'blocking-entry' | 'directory';
  name: string;
};

/** Every non-artifact entry in `home.locksDir`, sorted by name. A missing locks directory is not a
 * fault — nothing has ever locked here — and yields an empty list. Any other failure to read the
 * directory propagates: doctor turns that into a failed check, which is the honest report, since a
 * locks directory that cannot be listed is itself the problem. */
const listLockEntries = async (locksDir: string): Promise<{ isDir: boolean; name: string }[]> => {
  try {
    const entries = await readdir(locksDir, { withFileTypes: true });
    return entries
      .filter((entry) => !isProtocolArtifact(entry.name))
      .map((entry) => ({ isDir: entry.isDirectory(), name: entry.name }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
};

/** Diagnoses one entry, or `undefined` when the lock vanished between the directory listing and
 * this read. Disappearing is the normal end of a lock's life, not a finding — a released lock must
 * not show up as an anomaly just because the walk observed it a moment earlier. */
const inspectEntry = async (
  locksDir: string,
  entry: { isDir: boolean; name: string },
  observedAtMs: number,
): Promise<InspectedLock | undefined> => {
  if (!entry.isDir) {
    return { entry: 'blocking-entry', name: entry.name };
  }
  const diagnosis = await diagnoseLock(join(locksDir, entry.name), observedAtMs);
  // `policy: 'none'` means the directory was already gone by the time it was read.
  if (diagnosis.policy === 'none') {
    return undefined;
  }
  return { diagnosis, entry: 'directory', name: entry.name };
};

/** A snapshot of the locks directory. Every age in every diagnosis derives from one captured time,
 * so two entries in the same report cannot disagree about when "now" was. */
const inspectLocks = async (home: RefsHome): Promise<InspectedLock[]> => {
  const observedAtMs = Date.now();
  const entries = await listLockEntries(home.locksDir);
  const inspected = await Promise.all(
    entries.map((entry) => inspectEntry(home.locksDir, entry, observedAtMs)),
  );
  return inspected.filter((lock): lock is InspectedLock => lock !== undefined);
};

export { inspectLocks };
export type { InspectedLock };
