import { open, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Meta.json read/write/parse primitives for the advisory lock in `lock.ts`. Kept separate purely
// to keep that file's higher-level acquire/steal/release orchestration readable on its own.

// Signal 0 performs the existence/permission check without delivering anything.
const NO_SIGNAL = 0;
const META_FILENAME = 'meta.json';

// Prefix for the per-acquisition lease sidecar. The full name is `LEASE_PREFIX + token`, so every
// acquisition of the same lock path gets its OWN file — see `leaseSidecarPath` below for why that
// generation-specific identity is what makes a claim-free heartbeat safe.
const LEASE_PREFIX = 'lease-';

// `randomUUID()`'s exact output shape. Tokens are read back out of a `meta.json` that any process
// may have written, and the token becomes part of a filename, so it is validated before it is ever
// joined onto a path — an unvalidated token could otherwise carry `/` or `..`.
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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

// Same read, but keeping the reason: ENOENT is a lock that has not published its metadata yet (or
// has just been released), anything else is a file that exists and could not be read.
const readTextDetailed = async (
  path: string,
): Promise<{ state: 'missing' | 'unreadable' } | { state: 'read'; text: string }> => {
  try {
    return { state: 'read', text: await readFile(path, 'utf8') };
  } catch (error) {
    return { state: errnoCode(error) === 'ENOENT' ? 'missing' : 'unreadable' };
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

/** A fresh ownership token for one acquisition. Lives here, beside `TOKEN_PATTERN`, so the shape
 * that is written and the shape that is validated on the way back in are defined together. */
const newLockToken = (): string => randomUUID();

/** Path of the lease sidecar belonging to ONE acquisition of `lockPath`, or `undefined` when
 * `token` is not the exact `randomUUID()` shape this module writes.
 *
 * The generation-specific name is the whole point. A heartbeat renews by pathname, and a pathname
 * names a location, not the directory generation the holder originally acquired: by the time a
 * delayed renewal actually runs, `lockPath` may already have been stolen, removed and recreated by
 * a successor. With one constant sidecar name, that late write would land on the SUCCESSOR's file —
 * creating it where none existed, which would silently reclassify a non-renewing (older-CLI)
 * holder as a renewable one and expose it to the short lease. Naming the file after the acquisition
 * token means a late renewal targets a file that does not exist in the successor's directory, so it
 * fails with ENOENT and changes nothing. That is what lets the heartbeat skip the steal-claim
 * protocol entirely.
 *
 * Tokens reach this function from a `meta.json` written by another process, so the shape check is a
 * path-safety guard, not a formality. */
const leaseSidecarPath = (lockPath: string, token: string): string | undefined => {
  if (!TOKEN_PATTERN.test(token)) {
    return undefined;
  }
  return join(lockPath, `${LEASE_PREFIX}${token}`);
};

/** Creates this acquisition's (empty) lease sidecar. Only the content-free mtime is ever read, so
 * there is nothing to parse and nothing to observe half-written — the reason renewal can use
 * `utimes` instead of rewriting a file. */
const createLeaseSidecar = async (lockPath: string, token: string): Promise<void> => {
  const path = leaseSidecarPath(lockPath, token);
  /* v8 ignore next 3 -- `token` here is always this process's own `randomUUID()`; the guard exists
     for the read path, where the token comes off disk. */
  if (path === undefined) {
    return;
  }
  const handle = await open(path, 'w');
  await handle.close();
};

/** Renews the lease by stamping the sidecar's mtime. **Never creates it**: `utimes` on a missing
 * path fails with ENOENT, which is reported as `'gone'` and is exactly the harmless outcome
 * described on `leaseSidecarPath` when this acquisition's directory is no longer there. Any other
 * error propagates — a transient fs failure is the caller's to retry, not something to silently
 * read as "we lost the lock". */
const touchLeaseSidecar = async (lockPath: string, token: string): Promise<'gone' | 'renewed'> => {
  const path = leaseSidecarPath(lockPath, token);
  /* v8 ignore next 3 -- as in `createLeaseSidecar`: the heartbeat only ever renews with the token
     its own acquisition minted. */
  if (path === undefined) {
    return 'gone';
  }
  const now = new Date();
  try {
    await utimes(path, now, now);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return 'gone';
    }
    throw error;
  }
  return 'renewed';
};

/** The lease timestamp for `token`'s acquisition, or `undefined` when no sidecar exists for it —
 * which is how `isLockStale` recognizes a lock written by a CLI that does not renew, and applies
 * the legacy policy to it instead of the short lease. */
const leaseMtimeMs = async (lockPath: string, token: string): Promise<number | undefined> => {
  const path = leaseSidecarPath(lockPath, token);
  if (path === undefined) {
    // `path` IS undefined here — returned rather than written out as a literal, which the lint
    // rule against a bare `undefined` return would otherwise reject.
    return path;
  }
  return await dirMtimeMs(path);
};

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
  leaseMtimeMs,
  newLockToken,
  readLockMeta,
  readLockMetaDetailed,
  readLockToken,
  touchLeaseSidecar,
  writeInitialMeta,
};
export type { LockMeta, MetaRead };
