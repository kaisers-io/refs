import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Meta.json read/write/parse primitives for the advisory lock in `lock.ts`. Kept separate purely
// To keep that file's higher-level acquire/steal/release orchestration readable on its own.

// Signal 0 performs the existence/permission check without delivering anything.
const NO_SIGNAL = 0;
const META_FILENAME = 'meta.json';

interface LockMeta {
  acquiredAtMs: number;
  pid: number;
}

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
// Failure is treated as "alive" so we never steal a lock on uncertainty.
const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, NO_SIGNAL);
    return true;
  } catch (error) {
    return errnoCode(error) !== 'ESRCH';
  }
};

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

const parseLockMeta = (raw: unknown): LockMeta | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const { pid } = record;
  const acquiredAtMs = parseAcquiredAtMs(record['acquired_at']);
  if (typeof pid !== 'number' || acquiredAtMs === undefined) {
    return undefined;
  }
  return { acquiredAtMs, pid };
};

// Returns the lock's meta, or `undefined` when meta.json is missing, unreadable, or malformed —
// All of which fall into the mtime-grace-period bucket in `isLockStale` (`lock.ts`).
const readLockMeta = async (lockPath: string): Promise<LockMeta | undefined> => {
  const text = await readTextOrUndefined(join(lockPath, META_FILENAME));
  if (text === undefined) {
    return undefined;
  }
  return parseLockMeta(tryParseJson(text));
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

// Returns this lock's ownership `token`, or `undefined` when unreadable/malformed/missing.
// Callers treat `undefined` the same as "not ours" — see `releaseIfOwned` in `lock.ts`.
const readLockToken = async (lockPath: string): Promise<string | undefined> => {
  const text = await readTextOrUndefined(join(lockPath, META_FILENAME));
  if (text === undefined) {
    return undefined;
  }
  return extractToken(tryParseJson(text));
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
// Deliberately WITHOUT the parent-dir auto-`mkdir` that the shared `writeFileAtomic` in
// `fs-atomic.ts` does for its other callers: here the parent dir is the mutex itself, so silently
// Recreating it if momentarily missing would mask an identity-loss bug instead of surfacing it.
const writeMetaAtomic = async (lockPath: string, contents: string): Promise<void> => {
  const path = join(lockPath, META_FILENAME);
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, path);
};

const writeInitialMeta = async (lockPath: string, token: string): Promise<void> => {
  await writeMetaAtomic(
    lockPath,
    JSON.stringify({ acquired_at: new Date().toISOString(), pid: process.pid, token }),
  );
};

export { dirMtimeMs, errnoCode, isPidAlive, readLockMeta, readLockToken, writeInitialMeta };
