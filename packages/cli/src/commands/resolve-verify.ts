import type { RefKey, RefsHome, WorkspaceScan } from '@kaisers-io/refs-core';
import {
  RefsError,
  detectWorkspacePackagesDetailed,
  isGitCheckout,
  lookupPackagePath,
  probePackageIdentity,
  scanIsReliable,
  scanSearchedSomewhere,
  withLock,
} from '@kaisers-io/refs-core';
// `refLockName` lives in the CLI, not core — the same import `sync-checkout.ts` uses, so both
// commands derive the identical lock name and genuinely serialize against each other.
import { refLockName } from './add-source.ts';

// Identity verification for `refs resolve`. A configured `path` is a locator whose target the
// upstream repo can move, replace, or delete at any time — and `resolve` is the hot path where
// an unverified locator becomes an agent reading the wrong source and answering confidently
// wrong. Nothing else in the system catches that: it produces no error, just a wrong answer.
//
// The order below is load-bearing:
//
//   1. checkout absent            -> `unmaterialized`, path unchanged. The skill's existing
//                                    "resolve says missing -> sync re-clones" flow depends on it.
//   2. manifest read fails        -> `unverifiable`, path unchanged. A failed read is not an
//                                    absent package.
//   3. name matches               -> `verified`.
//   4. CONFIRMED mismatch/absence -> rescan, under the same per-ref lock `sync` mutates behind.

type PackageStatus =
  | 'ambiguous'
  | 'missing'
  | 'relocated'
  | 'unmaterialized'
  | 'unverifiable'
  | 'verified';

type VerifyOutcome = {
  candidates?: string[];
  configuredPath?: string;
  path: string | null;
  reason?: string;
  status: PackageStatus;
};

type VerifyOpts = {
  checkoutDir: string;
  configuredPath: string;
  home: RefsHome;
  key: RefKey;
  // Test seam only: production leaves this undefined so `withLock` keeps its own default.
  // Without it the lock-contention test would block for the full default timeout.
  lockTimeoutMs?: number;
  // Test seam only: fires once the lock-free probe has finished, before the lock is requested.
  // The race tests need to change the checkout in the window BETWEEN those two, and the only
  // alternative — sleeping and hoping the probe finished — makes them pass when they should
  // fail: if the probe were still running, it would observe the restored package itself and
  // return the expected answer through the fast path, with the locked re-probe never involved.
  onProbed?: () => void;
  packageName: string;
};

// eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
const NO_PATH = null;

/** Everything that happens once the lock is held.
 *
 * The re-probe is not redundant: the lock-free verify read may have raced a `sync` mid
 * `reset --hard`, and by the time the lock is granted the configured path can be perfectly valid
 * again. Scanning without re-probing would then report `relocated` — or, worse, `missing`, since
 * the scan cannot see a `path: "."` or packument-directory entry at all. */
const rescanLocked = async (opts: VerifyOpts): Promise<VerifyOutcome> => {
  const probe = await probePackageIdentity(opts.checkoutDir, opts.configuredPath, opts.packageName);
  if (probe.kind === 'match') {
    return { path: opts.configuredPath, status: 'verified' };
  }
  if (probe.kind === 'unreadable') {
    return { path: opts.configuredPath, reason: probe.reason, status: 'unverifiable' };
  }

  return searchScan(opts);
};

// Where does this package live according to a fresh scan of the checkout?
const incomplete = (opts: VerifyOpts, reason: string): VerifyOutcome => ({
  path: opts.configuredPath,
  reason,
  status: 'unverifiable',
});

const searchScan = async (opts: VerifyOpts): Promise<VerifyOutcome> => {
  const scan = await detectWorkspacePackagesDetailed(opts.checkoutDir);
  const lookup = lookupPackagePath(scan.packages, opts.packageName);
  const reliable = scanIsReliable(scan);

  // `ambiguous` is the one conclusion an incomplete scan can still support: seeing the name
  // twice already proves it is not unique, and inspecting more could only have found more.
  if (lookup.kind === 'ambiguous') {
    return {
      candidates: lookup.paths,
      configuredPath: opts.configuredPath,
      path: NO_PATH,
      status: 'ambiguous',
    };
  }

  // Both remaining answers claim something about EVERY path — "it is only here", "it is nowhere"
  // — so neither survives a scan that skipped something. A second package of the same name could
  // be sitting behind an unreadable manifest or an unsupported pattern, and picking the copy we
  // happened to see is precisely the silent wrong-directory failure this exists to prevent.
  if (!reliable) {
    return incomplete(
      opts,
      lookup.kind === 'found'
        ? 'workspace detection was incomplete, so the new location is not confirmed unique'
        : 'workspace detection was incomplete',
    );
  }

  return lookup.kind === 'found'
    ? { configuredPath: opts.configuredPath, path: lookup.path, status: 'relocated' }
    : absenceOutcome(opts, scan);
};

/** `missing` is the one answer a complete-but-EMPTY scan cannot support. A repo with no workspace
 * declaration yields exactly that: reliable, and derived from inspecting nothing. `add`'s npm
 * fallback registers packages in precisely those repos (`path: "."`, or the packument's
 * `directory`), so this is not a corner case — it is the ordinary shape of a single-package
 * upstream, and the one where a moved package would otherwise be declared gone on no evidence.
 *
 * `relocated` needs no such guard: a positive sighting stands on its own. */
const absenceOutcome = (opts: VerifyOpts, scan: WorkspaceScan): VerifyOutcome =>
  scanSearchedSomewhere(scan)
    ? { configuredPath: opts.configuredPath, path: NO_PATH, status: 'missing' }
    : incomplete(opts, 'this repo declares no workspaces, so there was nowhere to search');

/** Wraps `rescanLocked` in the per-ref lock `sync` mutates behind. `withLock` REJECTS with a
 * conflict error when the lock cannot be acquired in time, so the failure has to be caught: an
 * unacquirable lock means "could not check", never "the package is gone". Letting it escape
 * would turn ordinary lock contention into a command error on the hot path of every agent
 * question. */
const rescanFor = async (opts: VerifyOpts): Promise<VerifyOutcome> => {
  try {
    return await withLock(
      opts.home,
      refLockName(opts.key),
      () => rescanLocked(opts),
      opts.lockTimeoutMs === undefined ? undefined : { timeoutMs: opts.lockTimeoutMs },
    );
  } catch (error) {
    // ONLY the lock conflict becomes a status. Catching everything here would turn any defect
    // inside `rescanLocked` into a plausible-looking `unverifiable`, which is worse than a
    // crash: the caller is told the location could not be checked when in fact our own code
    // broke. Anything else propagates and `wrapAction` renders it as the unexpected error it is.
    if (error instanceof RefsError && error.code === 'conflict') {
      return {
        path: opts.configuredPath,
        reason: 'could not acquire the ref lock in time',
        status: 'unverifiable',
      };
    }
    throw error;
  }
};

const verifyPackageLocation = async (opts: VerifyOpts): Promise<VerifyOutcome> => {
  if (!isGitCheckout(opts.checkoutDir)) {
    return { path: opts.configuredPath, status: 'unmaterialized' };
  }

  // No lock for this read: it is on the hot path of every agent question. A read racing a
  // concurrent `sync` can return a STALE answer — `verified` for a path being replaced, say —
  // but never an unfounded one, and no lock could fix that anyway: the checkout can change the
  // instant after any lock is released. What the lock does protect is the NEGATIVE conclusions,
  // which is why the rescan below takes it and re-probes.
  const probe = await probePackageIdentity(opts.checkoutDir, opts.configuredPath, opts.packageName);
  if (probe.kind === 'match') {
    return { path: opts.configuredPath, status: 'verified' };
  }
  if (probe.kind === 'unreadable') {
    return { path: opts.configuredPath, reason: probe.reason, status: 'unverifiable' };
  }
  opts.onProbed?.();
  return rescanFor(opts);
};

export { verifyPackageLocation };
export type { PackageStatus, VerifyOutcome };
