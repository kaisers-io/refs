import type { LocationQuery, PackageStatus, VerifyOutcome } from './package-location.ts';
import type { PackageEntry, WorkspaceScan } from '@kaisers-io/refs-core';
import {
  detectWorkspacePackagesDetailed,
  probePackageIdentity,
  readRootPackage,
} from '@kaisers-io/refs-core';
import { classifyAgainstScan } from './package-location.ts';
import { errorMessageOf } from '../output.ts';

// Config drift: does every package a ref configures still live where the config says it does?
//
// `resolve` answers that for the ONE package an agent routed to, per call, and persists nothing —
// so a locator the upstream repo invalidated stays wrong until someone happens to resolve exactly
// that package. This probes all of them at once, for a caller that already holds the ref's lock
// (`sync`, right after its clone/reset; `doctor`, on request). It writes nothing: the answer is
// reported and then thrown away, deliberately, so there is no drift state to keep correct.
//
// Two properties this file exists to hold:
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
  packages?: StructureIssue[];
  reason?: string;
  status: DriftStatus;
};

type Settled = {
  outcome: VerifyOutcome;
  query: LocationQuery;
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

const DRIFT_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>([
  'ambiguous',
  'missing',
  'relocated',
  'unregistered',
]);

/** Sorted by package name so two runs over the same config report in the same order — `Map` keys
 * would otherwise carry whatever order the config file happened to be written in. */
const toQueries = (packages: Record<string, PackageEntry> | undefined): LocationQuery[] => {
  const entries = new Map(Object.entries(packages ?? {}));
  return [...entries.keys()].toSorted().flatMap((packageName) => {
    const entry = entries.get(packageName);
    return entry === undefined ? [] : [{ configuredPath: entry.path, packageName }];
  });
};

/** The cheap half: read the manifest at the configured path and compare the name. Resolves
 * `undefined` for the one outcome that cannot be settled from that read alone — the package is
 * not at its configured path — which is the only case worth scanning the whole checkout for. */
const probeEntry = async (
  checkoutDir: string,
  query: LocationQuery,
): Promise<VerifyOutcome | undefined> => {
  const probe = await probePackageIdentity(checkoutDir, query.configuredPath, query.packageName);
  if (probe.kind === 'match') {
    return { path: query.configuredPath, status: 'verified' };
  }
  if (probe.kind === 'unreadable') {
    return { path: query.configuredPath, reason: probe.reason, status: 'unverifiable' };
  }
  return undefined;
};

type Probe = {
  query: LocationQuery;
  settled: VerifyOutcome | undefined;
};

const settledOnly = (probed: readonly Probe[]): Settled[] =>
  probed.flatMap((item) =>
    item.settled === undefined ? [] : [{ outcome: item.settled, query: item.query }],
  );

/** ONE scan for the whole ref, shared by every package the cheap probe could not settle.
 * `resolve` scans per package because it only ever asks about one; a ref here can configure
 * dozens, and the scan is the expensive part. Sharing the snapshot also makes the answers
 * mutually consistent — they describe one state of the checkout, not N. */
const classifyAll = async (
  checkoutDir: string,
  queries: readonly LocationQuery[],
): Promise<Settled[]> => {
  const probed = await Promise.all(
    queries.map(async (query) => ({ query, settled: await probeEntry(checkoutDir, query) })),
  );
  if (probed.every((item) => item.settled !== undefined)) {
    return settledOnly(probed);
  }
  const scan: WorkspaceScan = await detectWorkspacePackagesDetailed(checkoutDir);
  return probed.map((item) => ({
    outcome: item.settled ?? classifyAgainstScan(item.query, scan),
    query: item.query,
  }));
};

const toIssue = (settled: Settled): StructureIssue[] => {
  const { outcome, query } = settled;
  if (!isIssueStatus(outcome.status)) {
    return [];
  }
  return [
    {
      ...(outcome.candidates === undefined ? {} : { candidates: outcome.candidates }),
      configured_path: query.configuredPath,
      name: query.packageName,
      ...(outcome.status === 'relocated' && outcome.path !== null ? { path: outcome.path } : {}),
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      status: outcome.status,
    },
  ];
};

/** `drift` outranks `unknown`: a ref with one confirmed relocation and one unreadable manifest has
 * definitely drifted, and reporting it as merely "could not check" would bury the fact that was
 * established. Both packages still appear in `packages`. */
const rollUp = (issues: readonly StructureIssue[]): StructureReport => {
  const [first] = issues;
  if (first === undefined) {
    return { status: 'ok' };
  }
  return {
    packages: [...issues],
    status: issues.some((issue) => DRIFT_STATUSES.has(issue.status)) ? 'drift' : 'unknown',
  };
};

/** The repository's own root package, when it declares a name the configuration does not register.
 *
 * This is the migration half of #88. `refs add` registers a named root now, but a ref added before
 * that keeps the package map it was given, and there is no command that adds one entry to an
 * existing ref — so without this the fix would only ever reach repositories tracked from scratch.
 * The drift probe already runs on every sync and holds both the checkout and the configuration, so
 * "the config has fallen behind the checkout" is exactly its question.
 *
 * Only asked of a ref that already registers packages. A plain reference repository registers none
 * on purpose, and nagging it about a root nobody asked to resolve would be noise on every sync.
 *
 * One manifest read, never a scan: the clean path must stay cheap. */
const unregisteredRoot = async (
  checkoutDir: string,
  configured: readonly LocationQuery[],
): Promise<StructureIssue[]> => {
  const root = await readRootPackage(checkoutDir);
  if (root === undefined || configured.some((query) => query.packageName === root.name)) {
    return [];
  }
  // Only now, and only because there is something to report: the cheap read says a name is
  // missing, but not where registering it would put it. A workspace member may declare the same
  // name, in which case detection drops the root and selects the member — so prescribing `.` from
  // the raw read would send someone to register the repository root where `refs add` would have
  // registered `packages/<member>`. The scan is what applies that rule, so the scan supplies the
  // path.
  const scan = await detectWorkspacePackagesDetailed(checkoutDir);
  const found = scan.packages.find((pkg) => pkg.name === root.name);
  // Nothing to prescribe if the scan cannot see it — better silent than pointing somewhere.
  return found === undefined
    ? []
    : [{ name: found.name, path: found.path, status: 'unregistered' }];
};

/** Probes every package `packages` configures against `checkoutDir`. LOCK-FREE by contract: the
 * caller holds the ref's lock. (`withLock` is not reentrant — taking it here would deadlock
 * `sync`, which is already holding it when it calls this.) An unexpected throw becomes a
 * whole-probe `unknown`, because an fs fault while looking is a fact about the look, never about
 * the packages. */
const probeRefStructure = async (
  checkoutDir: string,
  packages: Record<string, PackageEntry> | undefined,
): Promise<StructureReport> => {
  const queries = toQueries(packages);
  const [first] = queries;
  if (first === undefined) {
    return { status: 'ok' };
  }
  try {
    const [settled, rootIssue] = await Promise.all([
      classifyAll(checkoutDir, queries),
      unregisteredRoot(checkoutDir, queries),
    ]);
    return rollUp([...settled.flatMap((item) => toIssue(item)), ...rootIssue]);
  } catch (error) {
    return { reason: errorMessageOf(error), status: 'unknown' };
  }
};

const UNKNOWN_REASON = '(no reason given)';
const UNKNOWN_PATH = '(unknown)';

/** How one issue reads to a human. Shared by `sync` and `doctor` so the two never describe the
 * same finding differently — and worded so a removal and a relocation prescribe different work.
 *
 * The `missing` line states the ceiling of what was actually checked. Detection expands the repo's
 * own workspace declarations, so a package that moved somewhere no declaration covers is
 * indistinguishable here from one that was deleted. Naming that possibility costs six words and
 * keeps the line from prescribing the removal of an entry that only needs a new path — while the
 * primary repair still comes first, because deletion is by far the commoner cause. */
/** The one finding with no configured entry, so it carries no "configured:" tail — and the only
 * one whose repair no command performs. `refs add` refuses an already-tracked ref and
 * `refs edit --package` needs an entry to edit, so the honest instruction is the entry itself, in
 * the shape `config.toml` takes it. */
const unregisteredLine = (issue: StructureIssue): string =>
  `${issue.name}: declared by the repository root but not registered — the repository cannot be ` +
  `resolved by its own name until it is. Add under [refs."<ref>".packages."${issue.name}"]: ` +
  `path = "${issue.path ?? UNKNOWN_PATH}" and a description`;

/** The three findings about an entry that IS configured — each naming the repair it needs, and the
 * configured path it needs repairing from. */
const configuredIssueLine = (issue: StructureIssue): string => {
  const at = `configured: ${issue.configured_path ?? UNKNOWN_PATH}`;
  if (issue.status === 'relocated') {
    return `${issue.name}: moved to ${issue.path ?? UNKNOWN_PATH} — update the entry's path (${at})`;
  }
  if (issue.status === 'missing') {
    return (
      `${issue.name}: gone from this repo's workspaces — remove the entry, ` +
      `or repoint it if it moved out of them (${at})`
    );
  }
  if (issue.status === 'ambiguous') {
    const where = (issue.candidates ?? []).join(', ');
    return `${issue.name}: declared at several paths (${where}) — point the entry at one (${at})`;
  }
  return `${issue.name}: could not be checked — ${issue.reason ?? UNKNOWN_REASON} (${at})`;
};

const issueLine = (issue: StructureIssue): string =>
  issue.status === 'unregistered' ? unregisteredLine(issue) : configuredIssueLine(issue);

/** One line per thing worth saying, and EMPTY for a clean ref — so a caller can append the result
 * unconditionally and stay silent by construction rather than by remembering to check. */
const driftLines = (report: StructureReport): string[] => {
  if (report.reason !== undefined) {
    return [`could not be checked — ${report.reason}`];
  }
  return (report.packages ?? []).map((issue) => issueLine(issue));
};

export { driftLines, probeRefStructure };
export type { StructureIssue, StructureReport };
