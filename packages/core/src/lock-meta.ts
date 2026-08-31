import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createLeaseSidecar } from './lock-sidecar.ts';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Meta.json read/write/parse primitives for the advisory lock in `lock.ts`. Kept separate purely
// to keep that file's higher-level acquire/steal/release orchestration readable on its own.

// Signal 0 performs the existence/permission check without delivering anything.
const NO_SIGNAL = 0;
const META_FILENAME = 'meta.json';

type LockMeta = {
  acquiredAtMs: number;
  pid: number;
  // Absent when a `meta.json` carries no usable `token` — the lock is then treated as unownable by
  // anyone, which is what `releaseIfOwned` and the lease lookup already do with a mismatch.
  token?: string;
};

const errnoCode = (err: unknown): string | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const { code } = err as { code: unknown };
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
};

// Only ESRCH proves the process is gone; EPERM means it exists under another user, and any other
// failure is treated as "alive" so we never steal a lock on uncertainty.
const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, NO_SIGNAL);
    return true;
  } catch (error) {
    return errnoCode(error) !== 'ESRCH';
  }
};

// What a `meta.json` read established. `readLockMeta` collapses every failure into `undefined`,
// which is right for deciding staleness — anything unreadable is treated conservatively either way
// — but a diagnostic has to tell the cases apart: "the holder has not published yet" and "this
// file is corrupt" call for different words, and one of them is abnormal.
type MetaRead =
  | { meta: LockMeta; state: 'valid' }
  | { state: 'malformed' | 'missing' | 'unreadable' };

// `undefined` is a safe "parse failed" sentinel — see the identical note in `state-io.ts`.
const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const readTextOrUndefined = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
};

// Same read, but keeping the reason, because the reasons are not equivalent to whoever acts on
// them. Two of them mean "there is no metadata here and there never will be under this path":
// ENOENT (not published yet, or just released) and ENOTDIR (the lock name is occupied by something
// that is not a directory, so it cannot contain a `meta.json` at all). Both are `missing`, which
// puts them under the publication grace and lets an acquisition eventually reclaim the path.
//
// Everything else — EACCES, EIO — means the file is there and could not be read, which says nothing
// about the holder. That is `unreadable`, and it must never lead to a steal.
const NO_METADATA_CODES = new Set(['ENOENT', 'ENOTDIR']);

const readTextDetailed = async (
  path: string,
): Promise<{ state: 'missing' | 'unreadable' } | { state: 'read'; text: string }> => {
  try {
    return { state: 'read', text: await readFile(path, 'utf8') };
  } catch (error) {
    const code = errnoCode(error);
    return { state: code !== undefined && NO_METADATA_CODES.has(code) ? 'missing' : 'unreadable' };
  }
};

const parseAcquiredAtMs = (value: unknown): number | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) {
    return undefined;
  }
  return parsedMs;
};

const extractToken = (raw: unknown): string | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const { token } = raw as Record<string, unknown>;
  if (typeof token !== 'string') {
    return undefined;
  }
  return token;
};

// Largest value `process.kill` accepts. Beyond it Node throws `ERR_INVALID_ARG_TYPE` — a TypeError,
// not an errno — which `isPidAlive` would read as "not ESRCH, so present", reporting malformed
// metadata as a healthy holder.
const MAX_PID = 2_147_483_647;

/** A pid is only usable if it is a positive integer within the range `process.kill` accepts. `typeof pid === 'number'` was too loose: `0`
 * and negatives are process-GROUP selectors for `process.kill`, so a meta.json carrying either
 * would make `isPidAlive` answer for a whole group — reporting "alive" for a lock whose real owner
 * is long gone, and keeping it unreclaimable for the rest of its window. A non-integer is simply
 * not a pid, and one past `MAX_PID` makes the probe throw a TypeError that reads as "present".
 * All four are rejected here, which reports the metadata as malformed rather than acting on it. */
const parsePid = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > MAX_PID) {
    return undefined;
  }
  return value;
};

const parseLockMeta = (raw: unknown): LockMeta | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const pid = parsePid(record['pid']);
  const acquiredAtMs = parseAcquiredAtMs(record['acquired_at']);
  if (pid === undefined || acquiredAtMs === undefined) {
    return undefined;
  }
  const token = extractToken(raw);
  return { acquiredAtMs, pid, ...(token === undefined ? {} : { token }) };
};

// Returns the lock's meta, or `undefined` when meta.json is missing, unreadable, or malformed —
// all of which fall into the mtime-grace-period bucket in `isLockStale` (`lock.ts`).
const readLockMeta = async (lockPath: string): Promise<LockMeta | undefined> => {
  const text = await readTextOrUndefined(join(lockPath, META_FILENAME));
  if (text === undefined) {
    return undefined;
  }
  return parseLockMeta(tryParseJson(text));
};

// Returns this lock's ownership `token`, or `undefined` when unreadable/malformed/missing.
// Callers treat `undefined` the same as "not ours" — see `releaseIfOwned` in `lock.ts`.
const readLockToken = async (lockPath: string): Promise<string | undefined> => {
  const text = await readTextOrUndefined(join(lockPath, META_FILENAME));
  if (text === undefined) {
    return undefined;
  }
  return extractToken(tryParseJson(text));
};

/** `readLockMeta` with the failure reason preserved — see `MetaRead`. The two share one parser, so
 * a shape either reader accepts is a shape the other accepts too. */
const readLockMetaDetailed = async (lockPath: string): Promise<MetaRead> => {
  const read = await readTextDetailed(join(lockPath, META_FILENAME));
  if (read.state !== 'read') {
    return { state: read.state };
  }
  const meta = parseLockMeta(tryParseJson(read.text));
  if (meta === undefined) {
    return { state: 'malformed' };
  }
  return { meta, state: 'valid' };
};

/** `dirMtimeMs` with the failure reason preserved. The distinction matters to anything that
 * REPORTS on a lock rather than merely deciding whether to steal it: a path that is gone and a path
 * that cannot be stat'ed both yield no timestamp, but only the first means "there is nothing here".
 * Collapsing them lets a permissions fault read as an empty locks directory. */
const statMtime = async (
  path: string,
): Promise<{ mtimeMs: number; state: 'ok' } | { state: 'gone' } | { state: 'unreadable' }> => {
  try {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs, state: 'ok' };
  } catch (error) {
    return { state: errnoCode(error) === 'ENOENT' ? 'gone' : 'unreadable' };
  }
};

const dirMtimeMs = async (path: string): Promise<number | undefined> => {
  try {
    const info = await stat(path);
    return info.mtimeMs;
  } catch {
    return undefined;
  }
};

// Writes meta.json via a same-dir tmp file + rename (so a reader never observes a torn write),
// deliberately WITHOUT the parent-dir auto-`mkdir` that the shared `writeFileAtomic` in
// `fs-atomic.ts` does for its other callers: here the parent dir is the mutex itself, so silently
// recreating it if momentarily missing would mask an identity-loss bug instead of surfacing it.
const writeMetaAtomic = async (lockPath: string, contents: string): Promise<void> => {
  const path = join(lockPath, META_FILENAME);
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, path);
};

/** A fresh ownership token for one acquisition. The shape it produces is the shape
 * `lock-sidecar.ts` validates on the way back in — the two are a pair. */
const newLockToken = (): string => randomUUID();

/** Publishes an acquisition. Order is load-bearing: the lease sidecar is created FIRST, because
 * `meta.json` is the publication point — once it is readable, waiters treat the lock as held, and
 * a crash between the two writes in the other order would leave valid metadata with no sidecar,
 * i.e. a live lock permanently misread as legacy. Crashing before `meta.json` lands instead leaves
 * a meta-less directory, which the existing missing-meta grace period already handles. */
const writeInitialMeta = async (lockPath: string, token: string): Promise<void> => {
  await createLeaseSidecar(lockPath, token);
  await writeMetaAtomic(
    lockPath,
    JSON.stringify({ acquired_at: new Date().toISOString(), pid: process.pid, token }),
  );
};

export {
  dirMtimeMs,
  errnoCode,
  isPidAlive,
  newLockToken,
  readLockMeta,
  readLockMetaDetailed,
  readLockToken,
  statMtime,
  writeInitialMeta,
};
export type { LockMeta, MetaRead };
