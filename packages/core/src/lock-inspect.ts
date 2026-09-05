import { CLAIMS_DIRNAME } from './lock-steal.ts';
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

// The steal protocol keeps its own entries in `.claims/` and `.tombstones/` under the same
// directory. A lock name must start with an alphanumeric (`LOCK_NAME_PATTERN` in `lock.ts`), so a
// leading dot is unreachable by any real lock and no name-shape heuristic is needed to tell the
// two apart. That replaces what used to live here: a suffix match narrowed by an emptiness test,
// which could not distinguish a genuine lock for a repository named `foo.steal-claim` from the
// claim marker for `foo`, and could not distinguish a tombstone from the lock it had just been.
//
// Claims are reported rather than hidden. One is normal during a healthy steal and disappears with
// it — but since claims stopped being reclaimable by age, one left behind by a crashed stealer
// blocks stealing of that lock name until somebody removes it, and a thing that needs a human is a
// thing a diagnostic must show.

type InspectedLock = {
  diagnosis: LockDiagnosis;
  /** `claim` is a steal marker from `.claims/`, not a lock: it never carries metadata, so its
   * diagnosis says only how long it has been there. It blocks stealing of the lock of the same
   * name, and nothing else. */
  kind: 'claim' | 'lock';
  /** False for an entry that is not a directory. It still fails exclusive `mkdir`, so it does block
   * acquisition — but only until the metadata grace elapses, after which it is reclaimed like any
   * other unpublished entry (`stat` yields an mtime for a file just as it does for a directory).
   * Abnormal, therefore, but not permanent. */
  isDirectory: boolean;
  name: string;
};

/** Every entry in `home.locksDir`, sorted by name. A missing locks directory is not a fault —
 * nothing has ever locked here — and yields an empty list. Any other failure to read the directory
 * propagates: doctor turns that into a failed check, which is the honest report, since a locks
 * directory that cannot be listed is itself the problem. */
const PROTOCOL_DIR_PREFIX = '.';

const listDirEntries = async (dir: string): Promise<{ isDir: boolean; name: string }[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .map((entry) => ({ isDir: entry.isDirectory(), name: entry.name }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
};

/** The locks themselves: everything at the top level that is not one of the protocol's own
 * directories. Those are the only dot-prefixed entries that can be there, since a lock name cannot
 * begin with one. */
const listLockEntries = async (locksDir: string): Promise<{ isDir: boolean; name: string }[]> => {
  const entries = await listDirEntries(locksDir);
  return entries.filter((entry) => !entry.name.startsWith(PROTOCOL_DIR_PREFIX));
};

/** Diagnoses one entry, or `undefined` when it vanished between the directory listing and this
 * read. Disappearing is the normal end of a lock's life, not a finding — a released lock must not
 * show up as an anomaly just because the walk observed it a moment earlier.
 *
 * A non-directory goes through the same diagnosis rather than a special case: `stat` yields its
 * mtime, so the metadata grace applies to it exactly as it does to a lock whose `meta.json` has not
 * landed, and the acquisition path reclaims it on the same terms. */
const inspectEntry = async (
  locksDir: string,
  entry: { isDir: boolean; name: string },
  observedAtMs: number,
): Promise<InspectedLock | undefined> => {
  const diagnosis = await diagnoseLock(join(locksDir, entry.name), observedAtMs);
  // `policy: 'none'` means the entry was already gone by the time it was read.
  if (diagnosis.policy === 'none') {
    return undefined;
  }
  return { diagnosis, isDirectory: entry.isDir, kind: 'lock', name: entry.name };
};

/** Every steal claim currently in `.claims/`. A claim carries no metadata of its own, so its
 * diagnosis reduces to the publication grace against the directory's mtime — enough to say how
 * long it has been there, never enough to say it was abandoned. Reported for exactly that reason:
 * a human decides, and doctor gives them the age to decide on. */
const inspectClaims = async (locksDir: string, observedAtMs: number): Promise<InspectedLock[]> => {
  const claimsDir = join(locksDir, CLAIMS_DIRNAME);
  const entries = await listDirEntries(claimsDir);
  const inspected = await Promise.all(
    entries.map(async (entry) => ({
      diagnosis: await diagnoseLock(join(claimsDir, entry.name), observedAtMs),
      isDirectory: entry.isDir,
      kind: 'claim' as const,
      name: entry.name,
    })),
  );
  return inspected.filter((claim) => claim.diagnosis.policy !== 'none');
};

/** A snapshot of the locks directory. Every age in every diagnosis derives from one captured time,
 * so two entries in the same report cannot disagree about when "now" was. */
const inspectLocks = async (home: RefsHome): Promise<InspectedLock[]> => {
  const observedAtMs = Date.now();
  const entries = await listLockEntries(home.locksDir);
  const [inspected, claims] = await Promise.all([
    Promise.all(entries.map((entry) => inspectEntry(home.locksDir, entry, observedAtMs))),
    inspectClaims(home.locksDir, observedAtMs),
  ]);
  const locks = inspected.filter((lock): lock is InspectedLock => lock !== undefined);
  return [...locks, ...claims];
};

export { inspectLocks };
export type { InspectedLock };
