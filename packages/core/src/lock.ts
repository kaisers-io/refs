import { conflictError, validationError } from './errors.ts';
import {
  dirMtimeMs,
  errnoCode,
  isPidAlive,
  readLockMeta,
  readLockToken,
  writeInitialMeta,
} from './lock-meta.ts';
import { mkdir, rm } from 'node:fs/promises';
import { renameOrLostRace, tryExclusiveMkdir } from './lock-fs.ts';
import type { RefsHome } from './home.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Advisory cross-process locking for the refs home directory. meta.json read/write/parse
// primitives live in `lock-meta.ts`; this file is the acquire/steal/release orchestration.
//
// Acquire primitive: `mkdir(lockPath, { recursive: false })` — exactly one process creates the
// dir, everyone else gets EEXIST. `meta.json` inside records `{ pid, acquired_at, token }` so
// waiters can detect abandoned locks and a holder can prove, at release time, that the lock it's
// about to remove is still the one it acquired.
//
// Lock names (`'home'` or `ref.<key>`, `/` already replaced by `_`) are checked against a strict
// allowlist (`LOCK_NAME_PATTERN`) before ever being joined onto `locksDir`, since the result is
// used verbatim in `rm -rf`/`rename` targets — an unvalidated `..` would let a lock name delete
// the refs home itself.
//
// Stale-lock stealing is claim-gated, not just rename-fenced: a plain staleness read
// (`isLockStale`) is separated from any destructive step by an await, and in that gap another
// waiter can legitimately recycle `lockPath` into a brand-new, live lock — acting on the stale
// read directly would then destroy a live holder's lock. So a waiter first wins an exclusive
// steal claim (a separate `mkdir`-gated marker, same primitive as acquisition itself), and only
// the claim holder re-diagnoses staleness fresh, in place, with no move. Because legitimate
// acquisition requires `lockPath` to be absent — and it isn't, until the claim holder removes it
// — nothing can have mutated `lockPath` between claim and re-diagnosis. This closes the
// double-steal race by construction (a rename-first/restore-if-wrong scheme would still leave a
// residual window); `lock.test.ts` exercises it with a 12-waiter stress test.
//
// Remaining caveats (accepted for a local, single-user CLI, as in `home.ts`'s TOCTOU note): (1)
// release is read-then-delete — `withLock`'s `finally` only removes the lock dir when its token
// still matches, but a steal could interleave between that read and the `rm`; (2) a stealer
// crashing mid-steal leaks a tombstone or claim marker under `locksDir` — both inert or
// self-healing (`acquireStealClaim`), just harmless disk garbage.

// How often a waiter re-attempts acquisition while the lock is held by someone else.
const RETRY_INTERVAL_MS = 100;
// Default overall acquisition budget before giving up with a conflict error.
const DEFAULT_TIMEOUT_MS = 10_000;
// A lock whose meta.json `acquired_at` is older than this (10 minutes) is considered abandoned.
const MAX_LOCK_AGE_MS = 600_000;
// A dir with missing/corrupt meta.json is only stealable once older than this grace period — a
// freshly-created dir whose meta.json hasn't landed yet must NOT be stolen.
const MISSING_META_GRACE_MS = 5000;
// A steal-claim marker older than this is assumed abandoned by a crashed stealer and reclaimed,
// rather than left to permanently block stealing of that lock name.
const STEAL_CLAIM_STALE_MS = 2000;

// Strict allowlist: alphanumeric start, then alphanumerics/`_`/`.`/`-`. No `:` — it is not a
// legal character in Windows file names, and lock names become directory names. Also rejects "."
// and ".." explicitly (though the leading-alphanumeric requirement already excludes them) to make
// the intent unmistakable at the one call site that guards every destructive fs op below.
const LOCK_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;

// Identifies one lock (its dir, the shared locks dir it lives in, and its validated name) so the
// acquire/steal pipeline passes a single value instead of threading three strings everywhere.
type LockCtx = {
  lockPath: string;
  locksDir: string;
  name: string;
};

const isLockStale = async (lockPath: string): Promise<boolean> => {
  const meta = await readLockMeta(lockPath);
  if (meta === undefined) {
    const mtimeMs = await dirMtimeMs(lockPath);
    if (mtimeMs === undefined) {
      // The dir vanished between EEXIST and this check — the holder released; the next mkdir
      // attempt will simply succeed, no steal needed.
      return false;
    }
    return Date.now() - mtimeMs > MISSING_META_GRACE_MS;
  }
  if (Date.now() - meta.acquiredAtMs > MAX_LOCK_AGE_MS) {
    return true;
  }
  return !isPidAlive(meta.pid);
};

// Writes this acquisition's meta.json, reporting `'retry'` instead of throwing on ENOENT. Under
// the claim-gated steal design (module header) a fresh, meta-less dir is protected by
// `MISSING_META_GRACE_MS`, so this should not happen in practice; if it somehow does, the caller
// retries the whole acquire rather than crashing.
const writeMetaOrRetrySignal = async (
  lockPath: string,
  token: string,
): Promise<string | 'retry'> => {
  try {
    await writeInitialMeta(lockPath, token);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return 'retry';
    }
    throw error;
  }
  return token;
};

// True → we own the lock (dir created and meta.json written); returns this acquisition's fresh
// ownership token. `undefined` → held by someone else (lost the mkdir race — see `lock-fs.ts`
// for the Windows-aware code classification).
const tryAcquire = async (lockPath: string): Promise<string | undefined> => {
  const created = await tryExclusiveMkdir(lockPath);
  if (!created) {
    return undefined;
  }
  const written = await writeMetaOrRetrySignal(lockPath, randomUUID());
  if (written === 'retry') {
    return tryAcquire(lockPath);
  }
  return written;
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
// this rename. Either way the acquire loop's retry recovers.
const renameToTombstoneOrNoop = async (ctx: LockCtx): Promise<string | undefined> => {
  const tombstonePath = tombstonePathFor(ctx);
  const renamed = await renameOrLostRace(ctx.lockPath, tombstonePath);
  return renamed ? tombstonePath : undefined;
};

const removeIfStillStale = async (ctx: LockCtx): Promise<void> => {
  if (!(await isLockStale(ctx.lockPath))) {
    return;
  }
  const tombstonePath = await renameToTombstoneOrNoop(ctx);
  if (tombstonePath === undefined) {
    return;
  }
  await rm(tombstonePath, { force: true, recursive: true });
};

// Claim-gated steal: only the exclusive claim holder re-diagnoses and removes `ctx.lockPath`, in
// place (no move first) — see the module header for the full argument. If the re-diagnosis says
// "not stale", nothing is touched.
const stealStaleLock = async (ctx: LockCtx): Promise<void> => {
  const claimPath = claimPathFor(ctx);
  if (!(await acquireStealClaim(claimPath))) {
    return;
  }
  try {
    await removeIfStillStale(ctx);
  } finally {
    // Best-effort: if this fails or we crash here, the claim marker is a stale-reclaimable
    // leftover (see `acquireStealClaim`) — bounded, harmless garbage, same as a leaked tombstone.
    await rm(claimPath, { force: true, recursive: true });
  }
};

// One "the lock is currently held" step: steal it if abandoned (retry immediately afterwards),
// otherwise give up at the deadline or back off for one retry interval.
const stealOrWait = async (ctx: LockCtx, deadline: number): Promise<void> => {
  if (await isLockStale(ctx.lockPath)) {
    await stealStaleLock(ctx);
    return;
  }
  if (Date.now() >= deadline) {
    throw conflictError(`lock ${ctx.name} is held — another refs process is running`);
  }
  await delay(RETRY_INTERVAL_MS);
};

// Recursive rather than a loop so every await is a plain sequential step (the retry is inherently
// serial; async recursion does not grow the stack). Resolves with this acquisition's ownership
// token once the lock is held.
const acquireWithRetry = async (ctx: LockCtx, deadline: number): Promise<string> => {
  const token = await tryAcquire(ctx.lockPath);
  if (token !== undefined) {
    return token;
  }
  await stealOrWait(ctx, deadline);
  return acquireWithRetry(ctx, deadline);
};

// Only removes the lock dir when its current meta.json token still matches the token from this
// acquisition — i.e. nobody stole it while we held `fn`. A small read-then-delete TOCTOU window
// remains (see module header), but this closes the common case of an overlong hold getting
// stolen and then clobbering the new holder's lock on release.
const releaseIfOwned = async (lockPath: string, token: string): Promise<void> => {
  const ownerToken = await readLockToken(lockPath);
  if (ownerToken !== token) {
    return;
  }
  await rm(lockPath, { force: true, recursive: true });
};

// Rejects unless `name` matches the strict allowlist (see `LOCK_NAME_PATTERN`), checked explicitly
// against "." and ".." too (even though the pattern already excludes them) to make the intent
// unmistakable at the call site guarding every destructive fs op below.
const validateLockName = (name: string): void => {
  if (name === '.' || name === '..' || !LOCK_NAME_PATTERN.test(name)) {
    throw validationError(
      `lock name must not contain "/" or other unsafe characters — only letters, digits, and ` +
        `"_.-" are allowed, and it may not be "." or "..": ${name}`,
    );
  }
};

/**
 * Runs `fn` while holding the named advisory lock, releasing it in `finally` (also on throw).
 * Waits up to `opts.timeoutMs` (default 10s) for the lock, stealing it if abandoned; on timeout
 * rejects with a conflictError (exit code 5). `name` must match the strict allowlist enforced by
 * `validateLockName` — ref-key callers replace `/` with `_` before calling (e.g.
 * `ref.github.com_owner_repo`).
 */
// eslint-disable-next-line oxc/max-params -- public with-resource shape: (home, name, fn, opts?); an options object would bury the callback
const withLock = async <TResult>(
  home: RefsHome,
  name: string,
  fn: () => Promise<TResult>,
  opts?: { timeoutMs?: number },
): Promise<TResult> => {
  validateLockName(name);
  const ctx: LockCtx = { lockPath: join(home.locksDir, name), locksDir: home.locksDir, name };
  await mkdir(home.locksDir, { recursive: true });
  const deadline = Date.now() + (opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const token = await acquireWithRetry(ctx, deadline);
  try {
    return await fn();
  } finally {
    await releaseIfOwned(ctx.lockPath, token);
  }
};

export { withLock };
