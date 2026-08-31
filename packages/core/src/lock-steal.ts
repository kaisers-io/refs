import { renameOrLostRace, tryExclusiveMkdir } from './lock-fs.ts';
import { dirMtimeMs } from './lock-meta.ts';
import { isLockStale } from './lock-lease.ts';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

// Claim-gated stealing of an abandoned lock, split out of `lock.ts` so that file stays about
// acquire/wait/release. The full argument for why a steal needs an exclusive claim rather than a
// plain staleness read is in `lock.ts`'s module header; this file is that argument's implementation.

// A steal-claim marker older than this is assumed abandoned by a crashed stealer and reclaimed,
// rather than left to permanently block stealing of that lock name.
const STEAL_CLAIM_STALE_MS = 2000;

// Identifies one lock (its dir, the shared locks dir it lives in, and its validated name) so the
// acquire/steal pipeline passes a single value instead of threading three strings everywhere.
type LockCtx = {
  lockPath: string;
  locksDir: string;
  name: string;
};

const claimPathFor = (ctx: LockCtx): string => join(ctx.locksDir, `${ctx.name}.steal-claim`);

// `name` is already validated (no `/`, no `.`/`..`) and the suffix is our own UUID, so this path
// carries no unsanitised user input.
const tombstonePathFor = (ctx: LockCtx): string =>
  join(ctx.locksDir, `${ctx.name}.steal.${randomUUID()}`);

const isClaimStale = async (claimPath: string): Promise<boolean> => {
  const mtimeMs = await dirMtimeMs(claimPath);
  return mtimeMs !== undefined && Date.now() - mtimeMs > STEAL_CLAIM_STALE_MS;
};

// Wins the exclusive steal claim for this lock name, or `false` if someone else holds it. A claim
// older than `STEAL_CLAIM_STALE_MS` is assumed leftover from a crashed stealer (a claim's normal
// lifetime is a couple of fs calls) and is reclaimed instead of permanently blocking this name.
const acquireStealClaim = async (claimPath: string): Promise<boolean> => {
  if (await tryExclusiveMkdir(claimPath)) {
    return true;
  }
  if (!(await isClaimStale(claimPath))) {
    return false;
  }
  await rm(claimPath, { force: true, recursive: true });
  return tryExclusiveMkdir(claimPath);
};

// Atomically removes `ctx.lockPath` (rename-to-tombstone then `rm`, so a reader never observes a
// half-deleted dir), or does nothing (`undefined`) if the rename race was lost — already gone, or
// currently un-renamable on Windows (see `lock-fs.ts`) — between the caller's re-diagnosis and
// this rename. Either way the acquire loop's retry recovers: `undefined` propagates out as a falsy
// steal result, so the caller checks the deadline and then backs off, instead of spinning.
const renameToTombstoneOrNoop = async (ctx: LockCtx): Promise<string | undefined> => {
  const tombstonePath = tombstonePathFor(ctx);
  const renamed = await renameOrLostRace(ctx.lockPath, tombstonePath);
  return renamed ? tombstonePath : undefined;
};

// Resolves `true` only when the abandoned lock is actually gone, so the caller can tell a
// productive steal from one that changed nothing and must therefore back off.
const removeIfStillStale = async (ctx: LockCtx): Promise<boolean> => {
  if (!(await isLockStale(ctx.lockPath))) {
    return false;
  }
  const tombstonePath = await renameToTombstoneOrNoop(ctx);
  if (tombstonePath === undefined) {
    return false;
  }
  await rm(tombstonePath, { force: true, recursive: true });
  return true;
};

// Claim-gated steal: only the exclusive claim holder re-diagnoses and removes `ctx.lockPath`, in
// place (no move first) — see the module header for the full argument. If the re-diagnosis says
// "not stale", nothing is touched.
const stealStaleLock = async (ctx: LockCtx): Promise<boolean> => {
  const claimPath = claimPathFor(ctx);
  if (!(await acquireStealClaim(claimPath))) {
    return false;
  }
  try {
    return await removeIfStillStale(ctx);
  } finally {
    // Best-effort: if this fails or we crash here, the claim marker is a stale-reclaimable
    // leftover (see `acquireStealClaim`) — bounded, harmless garbage, same as a leaked tombstone.
    await rm(claimPath, { force: true, recursive: true });
  }
};

export { stealStaleLock };
export type { LockCtx };
