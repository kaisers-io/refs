import { diagnoseLock, isAutoReclaimable } from './lock-lease.ts';
import { mkdir, rm, rmdir } from 'node:fs/promises';
import { renameOrLostRace, tryExclusiveMkdir } from './lock-fs.ts';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readLockToken } from './lock-meta.ts';

// Claim-gated stealing of an abandoned lock, split out of `lock.ts` so that file stays about
// acquire/wait/release. The full argument for why a steal needs an exclusive claim rather than a
// plain staleness read is in `lock.ts`'s module header; this file is that argument's implementation.
//
// Three properties together are what make a steal safe, and none of them is sufficient alone:
//
//   1. **The claim never expires.** It is removed by the process that created it, and by nothing
//      else. It used to be reclaimable after two seconds, which meant it excluded only a stealer
//      fast enough to finish inside that window — a suspended one lost its claim mid-work, and two
//      stealers then raced the same lock. Age is not evidence of abandonment.
//   2. **Only a provably dead owner is stolen from automatically** (`isAutoReclaimable`). A live
//      holder can release at any instant, and a release is what lets the path become someone
//      else's lock underneath the stealer.
//   3. **The acquisition is re-identified after the death probe.** Death evidence alone is not
//      enough, because the metadata read and the pid probe are two observations with an `await`
//      between them: the owner can release and exit in that gap, a waiter can take the same path,
//      and the probe then reports the ORIGINAL owner dead while the path holds a live successor.
//      Re-reading the token closes exactly that gap — see `removeIfStillStale`.
//
// Everything the protocol writes lives in directories a lock name cannot occupy. Lock names must
// start with an alphanumeric (`LOCK_NAME_PATTERN` in `lock.ts`), so a leading `.` is unreachable
// by any real lock, and the suffix-collision the old sibling-entry layout had — a repository
// literally named `foo.steal-claim` produced the claim path of the lock for `foo` — cannot occur.

const CLAIMS_DIRNAME = '.claims';
const TOMBSTONES_DIRNAME = '.tombstones';

// Identifies one lock (its dir, the shared locks dir it lives in, and its validated name) so the
// acquire/steal pipeline passes a single value instead of threading three strings everywhere.
type LockCtx = {
  lockPath: string;
  locksDir: string;
  name: string;
};

/** The three paths one lock is addressed by. Built here rather than at the call site because
 * `LockCtx` is this module's type, and the layout it encodes — the lock beside the two protocol
 * directories — is this module's concern. */
const lockCtxFor = (locksDir: string, name: string): LockCtx => ({
  lockPath: join(locksDir, name),
  locksDir,
  name,
});

/** `<locksDir>/.claims/<name>` — the exclusive right to steal this lock name, not the lock. */
const claimPathFor = (ctx: LockCtx): string => join(ctx.locksDir, CLAIMS_DIRNAME, ctx.name);

/** `<locksDir>/.tombstones/<uuid>` — the transient name a lock is renamed to before removal, so a
 * reader never observes a half-deleted lock directory. Named by uuid alone rather than derived
 * from the lock name: nothing needs to map it back, and an unrelated name cannot collide with it. */
const tombstonePathFor = (ctx: LockCtx): string =>
  join(ctx.locksDir, TOMBSTONES_DIRNAME, randomUUID());

/** Both protocol directories, created up front so the steal path never has to distinguish "the
 * parent does not exist yet" from a real failure. `recursive` makes this idempotent. */
const ensureProtocolDirs = async (locksDir: string): Promise<void> => {
  await mkdir(join(locksDir, CLAIMS_DIRNAME), { recursive: true });
  await mkdir(join(locksDir, TOMBSTONES_DIRNAME), { recursive: true });
};

/** Wins the exclusive right to steal this lock name, or `false` if someone else holds it.
 *
 * No staleness test, deliberately: see property 1 in the module header. A claim left behind by a
 * crashed stealer therefore blocks stealing of that one lock name until it is removed by hand, and
 * `refs doctor` reports it with the command to do so. It does NOT block ordinary acquisition —
 * nothing outside this file consults it. */
const acquireStealClaim = (claimPath: string): Promise<boolean> => tryExclusiveMkdir(claimPath);

/** Gives up the claim. Genuinely best-effort, unlike the `finally` this replaces: a throw here
 * used to escape and replace the steal's own outcome, so a cleanup fault could be reported as a
 * failed steal — or, worse, mask a successful one. `rmdir`, not a recursive remove: a claim is a
 * bare `mkdir` and is always empty, so a non-empty directory at that path is something this code
 * does not understand and must not erase. */
const releaseStealClaim = async (claimPath: string): Promise<void> => {
  try {
    await rmdir(claimPath);
  } catch {
    // Left for `refs doctor` to report. Removing it needs a human anyway: nothing here can tell an
    // abandoned claim from one whose owner is merely suspended.
  }
};

/** Atomically removes `ctx.lockPath` (rename-to-tombstone then `rm`, so a reader never observes a
 * half-deleted dir), or does nothing (`undefined`) if the rename race was lost — already gone, or
 * currently un-renamable on Windows (see `lock-fs.ts`) — between the caller's re-diagnosis and
 * this rename. Either way the acquire loop's retry recovers: `undefined` propagates out as a falsy
 * steal result, so the caller checks the deadline and then backs off, instead of spinning. */
const renameToTombstoneOrNoop = async (ctx: LockCtx): Promise<string | undefined> => {
  const tombstonePath = tombstonePathFor(ctx);
  const renamed = await renameOrLostRace(ctx.lockPath, tombstonePath);
  return renamed ? tombstonePath : undefined;
};

/** Resolves `true` only when the abandoned lock is actually gone, so the caller can tell a
 * productive steal from one that changed nothing and must therefore back off.
 *
 * The token re-read between the diagnosis and the rename is the fence, and it is the whole of
 * issue #70. `diagnoseLock` reads `meta.json` and then probes the recorded pid, with an `await`
 * between them; in that window the owner can release and exit while a waiter takes the same path.
 * The probe would then answer for the departed owner while the path holds a live successor, and
 * the rename below would delete a lock somebody is using.
 *
 * Reading the token again after the death verdict says which acquisition is there NOW. If it is
 * still the one that was diagnosed, nothing can change it before the rename: its owner is proven
 * gone so it cannot release, the claim excludes every other stealer, and an ordinary acquirer
 * cannot win `mkdir` against a directory that exists. */
const removeIfStillStale = async (ctx: LockCtx): Promise<boolean> => {
  const diagnosis = await diagnoseLock(ctx.lockPath, Date.now());
  if (!isAutoReclaimable(diagnosis)) {
    return false;
  }
  if ((await readLockToken(ctx.lockPath)) !== diagnosis.token) {
    return false;
  }
  const tombstonePath = await renameToTombstoneOrNoop(ctx);
  if (tombstonePath === undefined) {
    return false;
  }
  await rm(tombstonePath, { force: true, recursive: true });
  return true;
};

/** Claim-gated steal: only the exclusive claim holder re-diagnoses and removes `ctx.lockPath`, in
 * place (no move first) — see the module header for the full argument. If the re-diagnosis says
 * the lock is not automatically reclaimable, or the acquisition changed underneath it, nothing is
 * touched. */
const stealStaleLock = async (ctx: LockCtx): Promise<boolean> => {
  await ensureProtocolDirs(ctx.locksDir);
  const claimPath = claimPathFor(ctx);
  if (!(await acquireStealClaim(claimPath))) {
    return false;
  }
  // Not `finally`: the cleanup must not be able to replace this result. `settled` is captured
  // first so a cleanup fault stays a cleanup fault.
  const settled = await removeIfStillStale(ctx).then(
    (stolen) => ({ ok: true as const, stolen }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  await releaseStealClaim(claimPath);
  if (!settled.ok) {
    throw settled.error;
  }
  return settled.stolen;
};

export { CLAIMS_DIRNAME, TOMBSTONES_DIRNAME, claimPathFor, lockCtxFor, stealStaleLock };
export type { LockCtx };
