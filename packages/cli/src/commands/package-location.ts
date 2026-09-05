import type { WorkspacePackage, WorkspaceScan } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { lookupPackagePath, scanIsReliable, scanSearchedSomewhere } from '@kaisers-io/refs-core';

// What one workspace scan is allowed to conclude about ONE configured package location.
//
// Split out of `resolve-verify.ts` so `sync`'s drift probe (`drift-probe.ts`) reaches the same
// rules without one command module importing another — and, more to the point, so the rules that
// decide when a scan may support "gone" or "uniquely here" keep exactly one definition. Both
// callers exist to prevent the same failure (an agent sent to the wrong source, or told to delete
// a package that is still there), and two copies of these rules would drift apart.
//
// The scan is passed IN rather than taken here, because the two callers scan differently:
// `resolve` scans once for the single package it routed to, while the drift probe scans a
// checkout once and classifies every configured package against that one snapshot.

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

/** The two facts a classification needs: which package we are looking for, and where the config
 * currently claims it lives. */
type LocationQuery = {
  configuredPath: string;
  packageName: string;
};

// eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
const NO_PATH = null;

const incomplete = (query: LocationQuery, reason: string): VerifyOutcome => ({
  path: query.configuredPath,
  reason,
  status: 'unverifiable',
});

/** `missing` is the one answer a complete-but-EMPTY scan cannot support. A repo with no workspace
 * declaration yields exactly that: reliable, and derived from inspecting nothing. `add`'s npm
 * fallback registers packages in precisely those repos (`path: "."`, or the packument's
 * `directory`), so this is not a corner case — it is the ordinary shape of a single-package
 * upstream, and the one where a moved package would otherwise be declared gone on no evidence.
 *
 * `relocated` needs no such guard: a positive sighting stands on its own. */
const absenceOutcome = (query: LocationQuery, scan: WorkspaceScan): VerifyOutcome =>
  scanSearchedSomewhere(scan)
    ? { configuredPath: query.configuredPath, path: NO_PATH, status: 'missing' }
    : incomplete(query, 'this repo declares no workspaces, so there was nowhere to search');

/** A scan that finds the package at the very path whose manifest just failed to identify it is
 * two reads of the same file disagreeing — a concurrent write, or a symlink one step resolved
 * differently. Reporting `relocated` here would print "moved to X" for a path already configured
 * as X, which is not a fact and not an instruction. It is a failure to observe: `unverifiable`. */
const isSelfRelocation = (query: LocationQuery, path: string): boolean =>
  path === query.configuredPath;

/** Where does this package live according to `scan`, given that its configured path no longer
 * identifies it? */
const ROOT_PACKAGE_PATH = '.';

/** The scan, minus the repository root.
 *
 * A root's name is an alias for the REPOSITORY, not evidence of where a package lives, and the two
 * must not be confused when answering "where did this package go?". Take a repo declaring
 * `@acme/toolkit` at both `.` and `packages/toolkit`: the member is what gets registered, and if
 * upstream then deletes it, the root is suddenly the only thing carrying that name. Reporting
 * `relocated` to `.` would send a caller to the repository root for a package that was removed,
 * and tell them about a move that never happened — the confidently-wrong answer this whole module
 * exists to prevent.
 *
 * A package genuinely moving INTO the root is indistinguishable from that alias, so it is given up
 * deliberately: the cost is one rare case reported as `missing` instead of `relocated`, against a
 * wrong directory handed out as if it were verified. The root is still verified directly when it
 * is the configured package itself — that path matches on its own manifest and never reaches
 * here. */
const withoutRoot = (scan: WorkspaceScan): WorkspacePackage[] =>
  scan.packages.filter((pkg) => pkg.path !== ROOT_PACKAGE_PATH);

const classifyAgainstScan = (query: LocationQuery, scan: WorkspaceScan): VerifyOutcome => {
  const lookup = lookupPackagePath(withoutRoot(scan), query.packageName);

  // `ambiguous` is the one conclusion an incomplete scan can still support: seeing the name
  // twice already proves it is not unique, and inspecting more could only have found more.
  if (lookup.kind === 'ambiguous') {
    return {
      candidates: lookup.paths,
      configuredPath: query.configuredPath,
      path: NO_PATH,
      status: 'ambiguous',
    };
  }

  // Both remaining answers claim something about EVERY path — "it is only here", "it is nowhere"
  // — so neither survives a scan that skipped something. A second package of the same name could
  // be sitting behind an unreadable manifest or an unsupported pattern, and picking the copy we
  // happened to see is precisely the silent wrong-directory failure this exists to prevent.
  if (!scanIsReliable(scan)) {
    return incomplete(
      query,
      lookup.kind === 'found'
        ? 'workspace detection was incomplete, so the new location is not confirmed unique'
        : 'workspace detection was incomplete',
    );
  }

  if (lookup.kind === 'absent') {
    return absenceOutcome(query, scan);
  }
  return isSelfRelocation(query, lookup.path)
    ? incomplete(query, 'the checkout changed while it was being inspected')
    : { configuredPath: query.configuredPath, path: lookup.path, status: 'relocated' };
};

export { NO_PATH, classifyAgainstScan };
export type { LocationQuery, PackageStatus, VerifyOutcome };
