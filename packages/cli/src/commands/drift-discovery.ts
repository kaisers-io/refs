import type { WorkspacePackage, WorkspaceScan } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import {
  detectWorkspacePackagesDetailed,
  lookupPackagePath,
  readRootPackage,
  scanIsReliable,
} from '@kaisers-io/refs-core';
import type { LocationQuery } from './package-location.ts';
import type { StructureIssue } from './drift-report.ts';

// The half of the drift probe that asks the opposite question: not "is this configured entry
// still right?" but "is anything missing from the list?".
//
// Both answers here are about names the CHECKOUT declares and the configuration does not have —
// the repository root (which is never one of its own glob targets, so `refs add` could not have
// registered it) and workspace members. Neither is a repair order: a package absent from the
// configuration may be absent on purpose.

/** At most ONE workspace scan per probe, shared by everything here that needs one.
 *
 * Three callers want it now — relocation classification, the unregistered root, unregistered
 * members — and each used to reach for its own. Beyond the cost (the scan is the expensive part
 * of the probe), a second scan is a second snapshot: two answers describing different states of
 * the same checkout is exactly the inconsistency `classifyAll` already shares one scan to avoid. */
type ScanOnce = () => Promise<WorkspaceScan>;

const scanOnceFor = (checkoutDir: string): ScanOnce => {
  let pending: Promise<WorkspaceScan> | undefined = undefined;
  return () => {
    pending ??= detectWorkspacePackagesDetailed(checkoutDir);
    return pending;
  };
};

/** Which unregistered workspace members a probe may report.
 *
 * `all` is `doctor`: an explicit, on-request inspection of everything, where a complete list is
 * the point. `arrivals` is `sync`, and carries the paths whose manifests this fetch ADDED — the
 * one honest way to say "new upstream" without an inventory of what was there before. A ref whose
 * owner deliberately tracks 3 packages out of 140 never hears about the other 137 again, because
 * their manifests are not in the diff; a package that genuinely landed in this pull is. */
type MemberDiscovery = { kind: 'all' } | { kind: 'arrivals'; paths: readonly string[] };

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
  scanOnce: ScanOnce,
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
  const scan = await scanOnce();
  // The same two conservatisms `classifyAgainstScan` applies, for the same reason. An incomplete
  // scan cannot support a definite path: a member sharing this name could be sitting behind the
  // unreadable manifest that made it incomplete, and it would win once readable — so prescribing
  // `.` now would be advice that a later sync contradicts. And more than one claimant is a real
  // ambiguity, not something to resolve by taking the first: `refs add` itself keeps the LAST,
  // so picking either here would be prescribing something registration does not do.
  if (!scanIsReliable(scan)) {
    return [];
  }
  const lookup = lookupPackagePath(scan.packages, root.name);
  if (lookup.kind === 'ambiguous') {
    return [{ candidates: lookup.paths, name: root.name, status: 'unregistered' }];
  }
  return lookup.kind === 'found'
    ? [{ name: root.name, path: lookup.path, status: 'unregistered' }]
    : [];
};

const ROOT_PACKAGE_PATH = '.';

/** Groups a scan's packages by name, so a name declared twice is reported as the ambiguity it is
 * rather than as a registration at whichever copy came first. `refs add` keeps the LAST of a
 * duplicate pair, so prescribing either path here would prescribe something registration does not
 * do — the same reason `unregisteredRoot` refuses an ambiguous lookup. */
const byName = (packages: readonly WorkspacePackage[]): Map<string, string[]> => {
  const grouped = new Map<string, string[]>();
  for (const pkg of packages) {
    grouped.set(pkg.name, [...(grouped.get(pkg.name) ?? []), pkg.path]);
  }
  return grouped;
};

const memberIssue = (name: string, paths: readonly string[]): StructureIssue =>
  paths.length === 1 && paths[0] !== undefined
    ? { name, path: paths[0], status: 'unregistered' }
    : { candidates: [...paths], name, status: 'unregistered' };

/** Workspace members the checkout declares and the configuration does not have.
 *
 * The root is excluded because `unregisteredRoot` owns it: it is found by looking rather than by
 * being declared, needs the manifest read that one does, and would otherwise be reported twice.
 *
 * No `scanIsReliable` guard, unlike every absence claim in `package-location.ts`, and the
 * asymmetry is deliberate: this reports packages the scan SAW. A positive sighting stands on its
 * own — an incomplete scan can only have missed more of them, which would make this list short,
 * never wrong. The claims that need a complete scan are the ones about every path ("it is
 * nowhere", "it is only here"), and none of those are made here. */
const unregisteredMembers = async (
  configured: readonly LocationQuery[],
  discovery: MemberDiscovery,
  scanOnce: ScanOnce,
): Promise<StructureIssue[]> => {
  if (discovery.kind === 'arrivals' && discovery.paths.length === 0) {
    return [];
  }
  const scan = await scanOnce();
  const registered = new Set(configured.map((query) => query.packageName));
  const arrived = discovery.kind === 'all' ? undefined : new Set(discovery.paths);
  const members = scan.packages.filter((pkg) => pkg.path !== ROOT_PACKAGE_PATH);
  // Grouped over EVERY member, then filtered — a name is ambiguous because of where it is
  // declared, not because of which declaration this fetch happened to add.
  return [...byName(members)]
    .filter(([name]) => !registered.has(name))
    .filter(([, paths]) => arrived === undefined || paths.some((path) => arrived.has(path)))
    .map(([name, paths]) => memberIssue(name, paths))
    .toSorted((left, right) => left.name.localeCompare(right.name));
};

export { scanOnceFor, unregisteredMembers, unregisteredRoot };
export type { MemberDiscovery, ScanOnce };
