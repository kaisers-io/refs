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
// flap on perfectly healthy concurrent activity.
//
// Both patterns share a namespace with real lock names, which permit `.` and `-`
// (`LOCK_NAME_PATTERN` in `lock.ts`), so matching on the suffix alone could hide a genuine lock for
// a repository named, say, `foo.steal-claim`. A claim is therefore only treated as one when the
// directory is EMPTY — a claim is a bare `mkdir` and always is, while a real lock carries
// `meta.json` and its lease sidecar.
//
// A tombstone admits no such test, and this is a deliberate limit rather than an oversight: a
// tombstone IS a real lock directory, just renamed a moment before removal, so it is structurally
// identical to the thing it must be told apart from. Only the name distinguishes them. Requiring a
// full uuid narrows the collision to a repository whose lock name ends in `.steal.` followed by
// exactly a 36-character uuid; anything short of that is reported normally. The alternative —
// reporting tombstones — would make this check flap on every healthy steal, which is a worse
// failure than a name nobody will ever have.
const CLAIM_SUFFIX = '.steal-claim';
const TOMBSTONE_PATTERN = /\.steal\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type InspectedLock = {
  diagnosis: LockDiagnosis;
  /** False for an entry that is not a directory. It still fails exclusive `mkdir`, so it does block
   * acquisition — but only until the metadata grace elapses, after which it is reclaimed like any
   * other unpublished entry (`stat` yields an mtime for a file just as it does for a directory).
   * Abnormal, therefore, but not permanent. */
  isDirectory: boolean;
  name: string;
};

const isEmptyDir = async (path: string): Promise<boolean> => {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch {
    return false;
  }
};

/** Whether this entry is one of the steal protocol's own markers rather than a lock. */
const isProtocolArtifact = async (locksDir: string, name: string): Promise<boolean> => {
  if (TOMBSTONE_PATTERN.test(name)) {
    return true;
  }
  if (!name.endsWith(CLAIM_SUFFIX)) {
    return false;
  }
  return await isEmptyDir(join(locksDir, name));
};

/** Every entry in `home.locksDir`, sorted by name. A missing locks directory is not a fault —
 * nothing has ever locked here — and yields an empty list. Any other failure to read the directory
 * propagates: doctor turns that into a failed check, which is the honest report, since a locks
 * directory that cannot be listed is itself the problem. */
const listLockEntries = async (locksDir: string): Promise<{ isDir: boolean; name: string }[]> => {
  try {
    const entries = await readdir(locksDir, { withFileTypes: true });
    const kept = await Promise.all(
      entries.map(async (entry) => ({
        artifact: await isProtocolArtifact(locksDir, entry.name),
        isDir: entry.isDirectory(),
        name: entry.name,
      })),
    );
    return kept
      .filter((entry) => !entry.artifact)
      .map((entry) => ({ isDir: entry.isDir, name: entry.name }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
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
  return { diagnosis, isDirectory: entry.isDir, name: entry.name };
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
