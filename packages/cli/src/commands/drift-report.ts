import type { DeclinedPackage } from '@kaisers-io/refs-core';
import type { PackageStatus } from './package-location.ts';

// What a config-drift probe can find, and how each finding reads to a human.
//
// Split out of `drift-probe.ts` so the probe, the discovery pass (`drift-discovery.ts`) and the
// two commands that print the result all name the same things — and so neither of the other two
// has to import the other. Two properties this vocabulary exists to hold:
//
//   1. A removal and a relocation are DIFFERENT answers. "It is gone, drop the entry" and "it
//      moved, fix the path" send whoever reads them to opposite places, and collapsing both into
//      a generic "drift" sends an agent hunting for something that is not there.
//   2. A failure to look is never evidence. Every expected filesystem problem becomes `unknown`,
//      never a drift claim and never a failed sync.

type DriftStatus = 'drift' | 'ok' | 'unknown';
/** `unregistered` is this file's own, and the only status here that is not about a configured
 * entry: the checkout declares a package the configuration does not have. Everything else answers
 * "is this entry still right?"; that one answers "is anything missing from the list?". */
type IssueStatus = Exclude<PackageStatus, 'unmaterialized' | 'verified'> | 'unregistered';

type StructureIssue = {
  candidates?: string[];
  /** Absent on `unregistered` — there is no configured entry, which is the finding. */
  configured_path?: string;
  name: string;
  path?: string;
  reason?: string;
  status: IssueStatus;
};

/** `packages` is ABSENT, never `[]`, when there is nothing to report — an empty array reads as
 * "this ref configures no packages", which is a different fact and one this probe never
 * establishes. `reason` appears only on a whole-probe `unknown`, where no per-package answer
 * exists at all. */
type StructureReport = {
  /** Why the unregistered-package pass did not run, when it did not. The scan it needs may have
   * missed a package, so its silence is not evidence — and a check that declined to look must not
   * answer `ok`. Distinct from `reason`, which is a whole-probe failure with no per-package answer
   * at all: here the CONFIGURED entries were checked normally and only discovery stood down. */
  /** Unregistered findings this ref's configuration has already answered, and which were
   * therefore left out of `discovery`. Present only when something was actually suppressed: the
   * decision stays visible to whoever asks, without becoming a second permanent warning. */
  declined?: DeclinedPackage[];
  /** What the checkout declares and the configuration does not have — kept apart from `packages`
   * and out of `status` on purpose.
   *
   * Two different assertions were being made by one field. A configuration expresses "every
   * registered route is valid"; putting an unregistered candidate in `packages` made the report
   * also assert "every declared package has received a registration decision", which nothing
   * justifies. A ref tracking 37 packages of a repository that declares 554 is not 517 oversights,
   * and this probe has no evidence either way. */
  discovery?: StructureIssue[];
  discovery_incomplete?: string;
  packages?: StructureIssue[];
  reason?: string;
  status: DriftStatus;
};

// `unmaterialized` cannot occur here (the caller holds the lock on a checkout that exists) and
// `verified` is the silent case, so neither is reportable — stated as a type so a future status
// cannot be added without deciding how it reads.
/** Narrows a `resolve` verdict to the ones this file reports. `unregistered` is not among them —
 * it is this file's own status and never comes back from a package location check. */
const isIssueStatus = (
  status: PackageStatus,
): status is Exclude<PackageStatus, 'unmaterialized' | 'verified'> =>
  status !== 'unmaterialized' && status !== 'verified';

// `unregistered` is deliberately absent: it is not a finding about a configured entry, so it
// cannot establish that the configuration has drifted from the checkout. It travels in
// `discovery`, where it says what exists rather than what is wrong. (`healthOf` filters those out
// before asking this set, so the absence is belt and braces — the filter is what carries the
// rule, and it is what a test should pin.)
const DRIFT_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>([
  'ambiguous',
  'missing',
  'relocated',
]);

/** `drift` outranks `unknown`: a ref with one confirmed relocation and one unreadable manifest has
 * definitely drifted, and reporting it as merely "could not check" would bury the fact that was
 * established. Both packages still appear in `packages`. */
/** `ok` means "looked, and everything is where the configuration says". An incomplete discovery
 * pass cannot support the second half of that, so it downgrades a silent report to `unknown` —
 * "nothing was found" and "the search was called off" are different answers, and this file's whole
 * vocabulary exists to keep them apart (see the header's second property).
 *
 * A report that already carries findings keeps whatever those findings make it. Today that is
 * always `unknown` in practice — `package-location.ts` refuses to settle any location against an
 * incomplete scan, so every verdict that would be drift becomes `unverifiable` first — but the
 * branch is written for what the types allow rather than for what currently reaches it. */
const rollUp = (
  issues: readonly StructureIssue[],
  extra: { declined?: readonly DeclinedPackage[]; discoveryIncomplete?: string } = {},
): StructureReport => {
  const { declined = [], discoveryIncomplete } = extra;
  const configured = issues.filter((issue) => issue.status !== 'unregistered');
  const found = issues.filter((issue) => issue.status === 'unregistered');
  return {
    ...(declined.length === 0 ? {} : { declined: [...declined] }),
    ...(found.length === 0 ? {} : { discovery: found }),
    ...(discoveryIncomplete === undefined ? {} : { discovery_incomplete: discoveryIncomplete }),
    ...(configured.length === 0 ? {} : { packages: configured }),
    status: healthOf(configured, discoveryIncomplete),
  };
};

/** The ref's health, decided by the CONFIGURED entries alone.
 *
 * An unregistered candidate cannot make a configuration wrong — nothing in it points anywhere for
 * that package. An incomplete discovery pass still downgrades `ok`, and for the reason it always
 * did: the scan those entries were checked against may have missed something, so "everything
 * resolves" is not a claim this run can make. */
const healthOf = (
  configured: readonly StructureIssue[],
  discoveryIncomplete: string | undefined,
): DriftStatus => {
  if (configured.some((issue) => DRIFT_STATUSES.has(issue.status))) {
    return 'drift';
  }
  return configured.length === 0 && discoveryIncomplete === undefined ? 'ok' : 'unknown';
};

export { DRIFT_STATUSES, isIssueStatus, rollUp };
export type { DriftStatus, IssueStatus, StructureIssue, StructureReport };
