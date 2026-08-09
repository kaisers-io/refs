import type { RefKey, RefsHome } from '@kaisers-io/refs-core';
import {
  detectWorkspacePackagesDetailed,
  isGitCheckout,
  lookupPackagePath,
  probePackageIdentity,
  scanIsReliable,
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
const searchScan = async (opts: VerifyOpts): Promise<VerifyOutcome> => {
  const scan = await detectWorkspacePackagesDetailed(opts.checkoutDir);
  const lookup = lookupPackagePath(scan.packages, opts.packageName);
  if (lookup.kind === 'found') {
    return { configuredPath: opts.configuredPath, path: lookup.path, status: 'relocated' };
  }
  if (lookup.kind === 'ambiguous') {
    return {
      candidates: lookup.paths,
      configuredPath: opts.configuredPath,
      path: NO_PATH,
      status: 'ambiguous',
    };
  }
  if (!scanIsReliable(scan)) {
    // Absence from an INCOMPLETE scan is not evidence of anything. Reporting `missing` here
    // would be a confident lie, and downstream that becomes "propose deleting this entry".
    return {
      path: opts.configuredPath,
      reason: 'workspace detection was incomplete',
      status: 'unverifiable',
    };
  }
  return { configuredPath: opts.configuredPath, path: NO_PATH, status: 'missing' };
};

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
    return {
      path: opts.configuredPath,
      reason: `could not verify under the ref lock: ${String(error)}`,
      status: 'unverifiable',
    };
  }
};

const verifyPackageLocation = async (opts: VerifyOpts): Promise<VerifyOutcome> => {
  if (!isGitCheckout(opts.checkoutDir)) {
    return { path: opts.configuredPath, status: 'unmaterialized' };
  }

  // No lock for this read: it is on the hot path of every agent question, and a torn read can
  // only route into the rescan branch below — never into a wrong answer.
  const probe = await probePackageIdentity(opts.checkoutDir, opts.configuredPath, opts.packageName);
  if (probe.kind === 'match') {
    return { path: opts.configuredPath, status: 'verified' };
  }
  if (probe.kind === 'unreadable') {
    return { path: opts.configuredPath, reason: probe.reason, status: 'unverifiable' };
  }
  return rescanFor(opts);
};

export { verifyPackageLocation };
export type { PackageStatus, VerifyOutcome };
