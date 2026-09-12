import type { PackagesBefore, WorkspacePackage, WorkspaceScan } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import {
  detectWorkspacePackagesDetailed,
  lookupPackagePath,
  readRootPackage,
  scanIsReliable,
} from '@kaisers-io/refs-core';
import type { LocationQuery } from './package-location.ts';
import type { StructureIssue } from './drift-report.ts';
import { discoveryObstacle } from './workspace-diagnostics.ts';

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
 * the point.
 *
 * `arrivals` is `sync`, and carries what the repository's packages looked like BEFORE the range it
 * just fetched — the one honest way to say "new upstream" without an inventory of what was there
 * before. A ref whose owner deliberately tracks 3 packages out of 140 never hears about the other
 * 137 again, because those names existed before; a package that genuinely landed in this pull did
 * not. It is stated as names rather than paths because that is the question: a package renamed in
 * place is new under a name nobody had, and a package merely MOVED is not new at all. */
type MemberDiscovery = { kind: 'all' } | ({ kind: 'arrivals' } & PackagesBefore);

/** What a discovery pass found, and — when it found nothing because it could not look — why.
 *
 * The two are reported together rather than collapsed into an empty array, because they are
 * different answers: "nothing is unregistered" and "the scan could have missed something" send the
 * reader to different places, and `doctor` answering `ok` for the second is the defect this shape
 * exists to prevent.
 *
 * Both passes carry it, and each has to. They gate on the same scan but run on different
 * conditions: the members pass stands down for an arrivals probe whose range changed no member
 * manifest, without scanning at all, while the root pass still scans and can still refuse. A sync
 * that changed only the root manifest hits exactly that combination — so leaving the root pass
 * silent would have kept the false `ok` for it. The caller reports whichever obstacle it gets,
 * once (`probeRefStructure`): one memoised scan produces one obstacle. */
type DiscoveryResult = { incomplete?: string; issues: StructureIssue[] };

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
): Promise<DiscoveryResult> => {
  const root = await readRootPackage(checkoutDir);
  if (root === undefined || configured.some((query) => query.packageName === root.name)) {
    return { issues: [] };
  }
  // Only now, and only because there is something to report: the cheap read says a name is
  // missing, but not where registering it would put it. A workspace member may declare the same
  // name, in which case detection drops the root and selects the member — so prescribing `.` from
  // the raw read would send someone to register the repository root where `refs add` would have
  // registered `packages/<member>`. The scan is what applies that rule, so the scan supplies the
  // path.
  const scan = await scanOnce();
  // The same two conservatisms `classifyAgainstScan` applies, for the same reason. A scan that
  // could have missed something cannot support a definite path: a member sharing this name could
  // be sitting behind the unreadable manifest that made it incomplete, and it would win once
  // readable — so prescribing `.` now would be advice that a later sync contradicts. And more than one claimant is a real
  // ambiguity, not something to resolve by taking the first: `refs add` itself keeps the LAST,
  // so picking either here would be prescribing something registration does not do.
  if (!scanIsReliable(scan)) {
    return { incomplete: discoveryObstacle(scan), issues: [] };
  }
  const lookup = lookupPackagePath(scan.packages, root.name);
  if (lookup.kind === 'ambiguous') {
    return { issues: [{ candidates: lookup.paths, name: root.name, status: 'unregistered' }] };
  }
  return {
    issues:
      lookup.kind === 'found'
        ? [{ name: root.name, path: lookup.path, status: 'unregistered' }]
        : [],
  };
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

/** Every package name the repository already had before the fetched range.
 *
 * Two sources, and the second is what keeps this cheap. `namesBefore` covers the manifests the
 * range actually changed, read out of history. Every OTHER member's manifest FILE is
 * byte-identical at both ends of the range, so the name it carries now is the name it carried
 * before — no read required, the scan already has it.
 *
 * "Manifest" means the path `<member>/package.json`. A member whose manifest is a symlink into the
 * repository declares its name somewhere that path does not name, so a rename there leaves the
 * member looking untouched and its new name is wrongly taken for its old one. Accepted limitation,
 * measured in #94; `arrivals.ts` carries the full reasoning. */
const namesThatExisted = (
  before: PackagesBefore,
  members: readonly WorkspacePackage[],
): Set<string> => {
  const changed = new Set(before.changedDirs);
  const untouched = members.filter((pkg) => !changed.has(pkg.path)).map((pkg) => pkg.name);
  return new Set([...before.namesBefore, ...untouched]);
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
 * Seeing a package is not the claim this finding makes: it says the package is an unregistered
 * MEMBER and names the path to register it at. Those two claims fail in different ways, so they
 * are guarded separately rather than behind one `scanIsReliable`.
 *
 * Uniqueness needs a scan that missed nothing: a second declaration of the same name could be
 * sitting behind an unreadable manifest or an unexpanded `**`, and `refs add` keeps the LAST of a
 * duplicate pair, so naming one path from a partial view prescribes something registration might
 * not do. `scanMayHidePackages` is that question.
 *
 * Membership fails only for negated patterns, and only under them. A negation is dropped rather
 * than applied, so a repository that wrote `!packages/fixtures` still has that directory in the
 * scan and recommending its registration would contradict the repository's own declaration —
 * but a negation hides nothing, and every package outside its prefix is unaffected. Gating the
 * whole pass on it silenced all hundred packages of a real monorepo over two negations that
 * applied to `examples/vue/`. */
const unregisteredMembers = async (
  configured: readonly LocationQuery[],
  discovery: MemberDiscovery,
  scanOnce: ScanOnce,
): Promise<DiscoveryResult> => {
  if (discovery.kind === 'arrivals' && discovery.changedDirs.length === 0) {
    // Nothing to discover, so nothing to report about a scan that was never run. Note what this
    // does NOT say: `changedDirs` excludes the repository root (`changedDirsOf`), and an arrivals
    // probe that could not read history at all arrives here the same way — so "no member manifest
    // in this range" is the claim, not "the range changed no manifest". The root pass covers the
    // first of those; the second is `arrivals.ts`'s own conservatism and predates this.
    return { issues: [] };
  }
  const scan = await scanOnce();
  if (!scanIsReliable(scan)) {
    return { incomplete: discoveryObstacle(scan), issues: [] };
  }
  const registered = new Set(configured.map((query) => query.packageName));
  const members = scan.packages.filter((pkg) => pkg.path !== ROOT_PACKAGE_PATH);
  const existed = discovery.kind === 'all' ? undefined : namesThatExisted(discovery, members);
  // Grouped over EVERY member, then filtered — a name is ambiguous because of where it is
  // declared, not because of which declaration this fetch happened to touch.
  const issues = [...byName(members)]
    .filter(([name]) => !registered.has(name))
    .filter(([name]) => existed === undefined || !existed.has(name))
    .map(([name, paths]) => memberIssue(name, paths))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return { issues };
};

export { scanOnceFor, unregisteredMembers, unregisteredRoot };
export type { DiscoveryResult, MemberDiscovery, ScanOnce };
