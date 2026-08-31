import {
  HEARTBEAT_MS,
  describeHeldLock,
  diagnoseLock,
  isLockStale,
  renewLease,
} from './lock-lease.ts';
import { conflictError, validationError } from './errors.ts';
import { errnoCode, newLockToken, readLockToken, writeInitialMeta } from './lock-meta.ts';
import { mkdir, rm } from 'node:fs/promises';
import type { Heartbeat } from './lock-heartbeat.ts';
import type { LockCtx } from './lock-steal.ts';
import type { RefsHome } from './home.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { startHeartbeat } from './lock-heartbeat.ts';
import { stealStaleLock } from './lock-steal.ts';
import { tryExclusiveMkdir } from './lock-fs.ts';

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
// Liveness is a LEASE, not a fixed age budget: a lock is abandoned when its process is definitely
// gone OR its lease has expired, never merely because the work has taken a long time. The policy
// and its rationale live in `lock-lease.ts`; the scheduler that stamps it, in `lock-heartbeat.ts`.
//
// Stale-lock stealing is claim-gated, not just rename-fenced: a plain staleness read
// (`isLockStale`) is separated from any destructive step by an await, and in that gap another
// waiter can legitimately recycle `lockPath` into a brand-new, live lock — acting on the stale
// read directly would then destroy a live holder's lock. So a waiter first wins an exclusive
// steal claim (a separate `mkdir`-gated marker, same primitive as acquisition itself), and only
// the claim holder re-diagnoses staleness fresh, in place, with no move. That excludes every OTHER
// stealer, which is what closes the double-steal race; `lock.test.ts` exercises it with a 12-waiter
// stress test.
//
// It does not, however, fence the re-diagnosis against the lock's own identity changing — see
// caveat (3). The heartbeat deliberately stays out of the claim protocol, and does not need to be
// in it for its own sake: it renews a sidecar named after its own acquisition token, so a delayed
// renewal aimed at a directory a successor has since recreated finds no file of that name and
// changes nothing (`leaseSidecarPath` in `lock-meta.ts`).
//
// Remaining caveats (accepted for a local, single-user CLI, as in `home.ts`'s TOCTOU note): (1)
// release is read-then-delete — `finishHold` only removes the lock dir when its token still
// matches, but a steal could interleave between that read and the `rm`; (2) a stealer crashing
// mid-steal leaks a tombstone or claim marker under `locksDir` — both inert or self-healing
// (`acquireStealClaim`), just harmless disk garbage; (3) the claim holder's re-diagnosis and its
// rename are not identity-fenced, so between the two the lock can legitimately become a different,
// live one — the holder releases and a waiter acquires, or a long-delayed renewal lands — and the
// stealer then removes that live lock. The claim excludes other stealers only; ordinary
// acquisition and renewal do not consult it. This predates the lease and is tracked separately;
// reaching it through renewal additionally requires every renewal in a full lease to have already
// been missed.

// How often a waiter re-attempts acquisition while the lock is held by someone else.
const RETRY_INTERVAL_MS = 100;
// Default overall acquisition budget before giving up with a conflict error.
const DEFAULT_TIMEOUT_MS = 10_000;

// Strict allowlist: alphanumeric start, then alphanumerics/`_`/`.`/`-`. No `:` — it is not a
// legal character in Windows file names, and lock names become directory names. Also rejects "."
// and ".." explicitly (though the leading-alphanumeric requirement already excludes them) to make
// the intent unmistakable at the one call site that guards every destructive fs op below.
const LOCK_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;

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
const tryAcquire = async (lockPath: string, deadline: number): Promise<string | undefined> => {
  const created = await tryExclusiveMkdir(lockPath);
  if (!created) {
    return undefined;
  }
  const written = await writeMetaOrRetrySignal(lockPath, newLockToken());
  if (written === 'retry') {
    // The dir we just created vanished under us — the release read-then-delete race in the module
    // header, or outside cleanup. Retrying at once is right, but it must still be bounded: without
    // the deadline, repeated interference spins here exactly as the steal path used to. Reporting
    // "not acquired" hands control back to the caller, whose own deadline check then raises the
    // conflictError.
    if (Date.now() >= deadline) {
      return undefined;
    }
    return tryAcquire(lockPath, deadline);
  }
  return written;
};

// One "the lock is currently held" step: a steal that actually cleared the abandoned lock earns an
// immediate retry, because the way is now open and backing off would only hand the slot to someone
// else. Everything else — the lock is genuinely held, we lost the steal claim to another waiter, or
// the removal did not take — is "try again later" and must honour the deadline.
//
// That last part is load-bearing. The stale branch used to return unconditionally, checking neither
// the deadline nor backing off, so a lock that stayed stale-but-unstealable spun hot forever and
// `withLock`'s documented `timeoutMs` was unenforceable. On Windows it also fed the problem it was
// stuck on: each spin re-reads `meta.json` inside the lock directory, and an open handle in there
// is exactly what makes the tombstone rename fail with a sharing violation.
const stealOrWait = async (ctx: LockCtx, deadline: number): Promise<void> => {
  if ((await isLockStale(ctx.lockPath)) && (await stealStaleLock(ctx))) {
    return;
  }
  if (Date.now() >= deadline) {
    // Diagnosed fresh rather than reusing the staleness read above. The extra read costs one stat
    // on a path that is already failing, and reusing the earlier one would not make the message
    // authoritative anyway: the lock's identity can change between any observation and its
    // reporting. Describing what is there NOW is the more useful of two non-authoritative answers.
    const diagnosis = await diagnoseLock(ctx.lockPath, Date.now());
    throw conflictError(describeHeldLock(ctx.name, diagnosis));
  }
  await delay(RETRY_INTERVAL_MS);
};

// Recursive rather than a loop so every await is a plain sequential step (the retry is inherently
// serial; async recursion does not grow the stack). Resolves with this acquisition's ownership
// token once the lock is held.
const acquireWithRetry = async (ctx: LockCtx, deadline: number): Promise<string> => {
  const token = await tryAcquire(ctx.lockPath, deadline);
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
/** Resolves `true` when the lock was still ours and has now been removed, `false` when it had been
 * stolen — the caller turns that into a reported ownership loss rather than discarding it, since a
 * theft can happen after the final heartbeat and before `fn` returns. */
const releaseIfOwned = async (lockPath: string, token: string): Promise<boolean> => {
  const ownerToken = await readLockToken(lockPath);
  if (ownerToken !== token) {
    return false;
  }
  await rm(lockPath, { force: true, recursive: true });
  return true;
};

// `fn`'s outcome, captured rather than propagated, so release and the ownership verdict still run
// in order afterwards and a failing `fn` keeps precedence over any lock-level complaint.
type Settled<TResult> = { ok: true; value: TResult } | { error: unknown; ok: false };

const settle = async <TResult>(fn: () => Promise<TResult>): Promise<Settled<TResult>> => {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { error, ok: false };
  }
};

/** Winds a hold down and decides what the caller sees. Order is load-bearing: the heartbeat is
 * quiesced BEFORE releasing, so no renewal is still in flight when the lock directory goes away and
 * is potentially recreated by the next holder. Then `fn`'s own failure takes precedence over any
 * lock-level complaint, and only a `fn` that SUCCEEDED without mutual exclusion is turned into a
 * conflict — its result ran unprotected and is not trustworthy. */
// eslint-disable-next-line max-params -- (ctx, token, heartbeat, outcome): the wind-down needs all four, and an options object would obscure a purely internal call shape
const finishHold = async <TResult>(
  ctx: LockCtx,
  token: string,
  heartbeat: Heartbeat,
  outcome: Settled<TResult>,
): Promise<TResult> => {
  // `stop` cannot reject: every renewal outcome is handled inside the heartbeat, so the promise it
  // awaits always settles. Release can — `rm` is real I/O — so it is captured rather than awaited
  // bare, or an unlink failure here would replace the callback's own error and the precedence
  // promised above would silently not hold.
  await heartbeat.stop();
  const released = await settle(() => releaseIfOwned(ctx.lockPath, token));
  if (!outcome.ok) {
    throw outcome.error;
  }
  if (!released.ok) {
    throw released.error;
  }
  if (heartbeat.ownershipLost() || !released.value) {
    throw conflictError(`lock ${ctx.name} was lost while the operation was running`);
  }
  return outcome.value;
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
 * Runs `fn` while holding the named advisory lock, always releasing it afterwards (also on throw).
 * Waits up to `opts.timeoutMs` (default 10s) for the lock, stealing it if abandoned; on timeout
 * rejects with a conflictError (exit code 5). `name` must match the strict allowlist enforced by
 * `validateLockName` — ref-key callers replace `/` with `_` before calling (e.g.
 * `ref.github.com_owner_repo`).
 *
 * The lock is held for as long as `fn` runs, however long that is: a heartbeat renews the lease
 * throughout (module header). If ownership is nevertheless lost — observed by the heartbeat, or by
 * release finding a foreign token — and `fn` itself SUCCEEDED, this rejects with a conflictError:
 * the work ran without the mutual exclusion it asked for, so its result is not trustworthy. A `fn`
 * that failed on its own keeps precedence; its error is what the caller sees.
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
  const heartbeat = startHeartbeat({
    intervalMs: HEARTBEAT_MS,
    renew: () => renewLease(ctx.lockPath, token),
  });
  return finishHold(ctx, token, heartbeat, await settle(fn));
};

export { withLock };
