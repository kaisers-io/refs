import { mkdir, rename } from 'node:fs/promises';
import { errnoCode } from './lock-meta.ts';

// Windows-aware "lost race" classification for the lock's raw fs primitives — split out of
// `lock.ts` purely to keep that file's acquire/steal/release orchestration under the repo's line
// cap, the same reason `lock-meta.ts` exists.
//
// - mkdir: EEXIST means held by someone else; EPERM/EACCES/EBUSY appear on Windows when the same
//   path is still delete-pending after another waiter's rm (directories are removed
//   asynchronously there) — both mean "not ours right now", and the caller's retry loop simply
//   re-attempts. A genuine POSIX permission problem therefore surfaces as the standard
//   lock-timeout conflict instead of a crash — acceptable for an advisory lock.
// - rename: ENOENT means the source is already gone (holder released / a previous steal won);
//   EPERM/EACCES/EBUSY appear on Windows while another process holds an open handle inside the
//   directory (sharing violation) — same "lost the race" treatment, same retry-loop recovery.
const MKDIR_LOST_RACE_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const RENAME_LOST_RACE_CODES = new Set(['ENOENT', 'EPERM', 'EACCES', 'EBUSY']);

/** `mkdir` as an exclusive-acquisition attempt: `true` → created (race won), `false` → lost. */
const tryExclusiveMkdir = async (path: string): Promise<boolean> => {
  try {
    await mkdir(path, { recursive: false });
    return true;
  } catch (error) {
    const code = errnoCode(error);
    if (code !== undefined && MKDIR_LOST_RACE_CODES.has(code)) {
      return false;
    }
    throw error;
  }
};

/** `rename` as a claim-the-dir attempt: `true` → renamed (race won), `false` → lost. */
const renameOrLostRace = async (from: string, to: string): Promise<boolean> => {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    const code = errnoCode(error);
    if (code !== undefined && RENAME_LOST_RACE_CODES.has(code)) {
      return false;
    }
    throw error;
  }
};

export { renameOrLostRace, tryExclusiveMkdir };
