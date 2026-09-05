import type { LocationQuery, VerifyOutcome } from './package-location.ts';
import type { MemberDiscovery, ScanOnce } from './drift-discovery.ts';
import type { PackageEntry, WorkspaceScan } from '@kaisers-io/refs-core';
import type { StructureIssue, StructureReport } from './drift-report.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { isIssueStatus, rollUp } from './drift-report.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { scanOnceFor, unregisteredMembers, unregisteredRoot } from './drift-discovery.ts';
import { classifyAgainstScan } from './package-location.ts';
import { errorMessageOf } from '../output.ts';
import { probePackageIdentity } from '@kaisers-io/refs-core';

// Config drift: does every package a ref configures still live where the config says it does?
//
// `resolve` answers that for the ONE package an agent routed to, per call, and persists nothing —
// so a locator the upstream repo invalidated stays wrong until someone happens to resolve exactly
// that package. This probes all of them at once, for a caller that already holds the ref's lock
// (`sync`, right after its clone/reset; `doctor`, on request). It writes nothing: the answer is
// reported and then thrown away, deliberately, so there is no drift state to keep correct.
//
// The vocabulary of findings and their wording live in `drift-report.ts`; the "what is missing
// from the list?" pass lives in `drift-discovery.ts`.

type Settled = {
  outcome: VerifyOutcome;
  query: LocationQuery;
};

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
  scanOnce: ScanOnce,
): Promise<Settled[]> => {
  const probed = await Promise.all(
    queries.map(async (query) => ({ query, settled: await probeEntry(checkoutDir, query) })),
  );
  if (probed.every((item) => item.settled !== undefined)) {
    return settledOnly(probed);
  }
  const scan: WorkspaceScan = await scanOnce();
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

/** Probes every package `packages` configures against `checkoutDir`. LOCK-FREE by contract: the
 * caller holds the ref's lock. (`withLock` is not reentrant — taking it here would deadlock
 * `sync`, which is already holding it when it calls this.) An unexpected throw becomes a
 * whole-probe `unknown`, because an fs fault while looking is a fact about the look, never about
 * the packages. */
const probeRefStructure = async (
  checkoutDir: string,
  packages: Record<string, PackageEntry> | undefined,
  discovery: MemberDiscovery,
): Promise<StructureReport> => {
  const queries = toQueries(packages);
  const [first] = queries;
  if (first === undefined) {
    return { status: 'ok' };
  }
  const scanOnce = scanOnceFor(checkoutDir);
  try {
    const [settled, rootIssue, memberIssues] = await Promise.all([
      classifyAll(checkoutDir, queries, scanOnce),
      unregisteredRoot(checkoutDir, queries, scanOnce),
      unregisteredMembers(queries, discovery, scanOnce),
    ]);
    return rollUp([...settled.flatMap((item) => toIssue(item)), ...rootIssue, ...memberIssues]);
  } catch (error) {
    return { reason: errorMessageOf(error), status: 'unknown' };
  }
};

export { probeRefStructure };
