import { open, stat, utimes } from 'node:fs/promises';
import { isEnoent } from './fs-atomic.ts';
import { join } from 'node:path';

// The per-acquisition lease sidecar: an empty file whose mtime IS the lease timestamp. Split out of
// `lock-meta.ts` because it is a distinct mechanism — `meta.json` records who holds a lock, this
// records how recently they said so — and because the two together outgrew one file.

// Prefix for the per-acquisition lease sidecar. The full name is `LEASE_PREFIX + token`, so every
// acquisition of the same lock path gets its OWN file — see `leaseSidecarPath` below for why that
// generation-specific identity is what makes a claim-free heartbeat safe.
const LEASE_PREFIX = 'lease-';

// `randomUUID()`'s exact output shape. Tokens are read back out of a `meta.json` that any process
// may have written, and the token becomes part of a filename, so it is validated before it is ever
// joined onto a path — an unvalidated token could otherwise carry `/` or `..`.
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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
    if (isEnoent(error)) {
      return 'gone';
    }
    throw error;
  }
  return 'renewed';
};

/** The lease timestamp for `token`'s acquisition.
 *
 * The three outcomes are kept apart on purpose. `'absent'` means this acquisition has no sidecar,
 * which is what selects the legacy window — and that window is measured from acquisition, so it can
 * mark a long-held lock stale. Collapsing an unreadable sidecar into the same answer would
 * therefore let a permissions or I/O fault hand a live, renewing holder's lock to a waiter: exactly
 * the dispossession the lease exists to prevent, arrived at from the other direction. */
const leaseMtimeMs = async (
  lockPath: string,
  token: string,
): Promise<{ mtimeMs: number; state: 'ok' } | { state: 'absent' } | { state: 'unreadable' }> => {
  const path = leaseSidecarPath(lockPath, token);
  if (path === undefined) {
    // An unusable token has no sidecar it could name — genuinely absent, not unreadable.
    return { state: 'absent' };
  }
  try {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs, state: 'ok' };
  } catch (error) {
    return { state: isEnoent(error) ? 'absent' : 'unreadable' };
  }
};

export { createLeaseSidecar, leaseMtimeMs, touchLeaseSidecar };
