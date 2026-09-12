import { editCommand, shellQuote } from '../shell-quote.ts';
import { isRegistrablePackageName, zPackagePath } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
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
   * therefore left out of `packages`. Present only when something was actually suppressed: the
   * decision stays visible to whoever asks, without becoming a second permanent warning. */
  declined?: DeclinedPackage[];
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

const DRIFT_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>([
  'ambiguous',
  'missing',
  'relocated',
  'unregistered',
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
  const suppressed = declined.length === 0 ? {} : { declined: [...declined] };
  const [first] = issues;
  if (first === undefined) {
    return discoveryIncomplete === undefined
      ? { ...suppressed, status: 'ok' }
      : { ...suppressed, discovery_incomplete: discoveryIncomplete, status: 'unknown' };
  }
  return {
    ...suppressed,
    ...(discoveryIncomplete === undefined ? {} : { discovery_incomplete: discoveryIncomplete }),
    packages: [...issues],
    status: issues.some((issue) => DRIFT_STATUSES.has(issue.status)) ? 'drift' : 'unknown',
  };
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
/** The one finding with no configured entry, so it carries no "configured:" tail.
 *
 * Worded for both of its sources — the repository root and a workspace member — because the
 * consequence is the same either way: a name the checkout declares and the configuration does not
 * have cannot be resolved. The root's own wording used to say so; nothing about it was specific to
 * the root.
 *
 * The ref key is interpolated rather than left as a `<ref>` placeholder: a shell reads `<ref>` as
 * an input redirection, so a line carrying one cannot be run as printed — which is the whole
 * point of printing a command instead of a config fragment.
 *
 * It names a COMMAND now rather than a `config.toml` fragment. That is `refs edit --create`'s
 * whole reason for existing: this was the one finding no command could repair, so the only honest
 * instruction was "hand-edit the config". The description is deliberately left for the caller to
 * write and not filled in from the manifest — see SKILL.md on what a checkout's own text may and
 * may not be used for.
 *
 * Both interpolated values are shell-quoted, for the reason `shell-quote.ts` was written down:
 * a package NAME comes from a tracked repository's own manifest and is checked only for being
 * non-empty, and `zPackagePath` rejects only separators, dot segments, percent escapes and colons
 * — `$()`, backticks, semicolons and spaces all pass. This line exists to be pasted into a shell,
 * so an unquoted value here is an execution primitive handed to whoever runs it. Being verified
 * against the checkout makes a value TRUE, not shell-safe. */
/** Whether the configuration could actually hold this package. Detection and registration answer
 * different questions: a workspace member may legitimately be named `constructor` or sit at
 * `packages/100%`, and the scan reports it correctly, while `zRefEntry` rejects both. Printing a
 * command that fails validation is worse than printing none — the finding is still true, so it is
 * reported with the reason instead. */
const registrable = (issue: StructureIssue): boolean =>
  isRegistrablePackageName(issue.name) && zPackagePath.safeParse(issue.path).success;

const unregisteredLine = (issue: StructureIssue, key: string): string => {
  const head = `${issue.name}: declared in this checkout but not registered — it cannot be resolved by name until it is`;
  if (issue.path === undefined) {
    // More than one directory declares this name, so which one to register is a decision, not a
    // lookup. Naming the candidates is the most this can honestly do.
    return `${head}. Declared at several paths (${(issue.candidates ?? []).join(', ')}) — pick one`;
  }
  if (!registrable(issue)) {
    return (
      `${head}. Its name or path is one the configuration cannot hold, so there is no command ` +
      `for it — report it and leave it unregistered`
    );
  }
  const register = editCommand(
    [
      `--package=${shellQuote(issue.name)}`,
      '--create',
      `--path=${shellQuote(issue.path)}`,
      '--description="<what it is>"',
    ],
    [key],
  );
  // Both answers, because both are answers. Registering is the one that needs a human decision
  // (SKILL.md: never on your own initiative), and declining is what stops the finding returning
  // on every run once that decision was "no" — without it the only way to quieten this line was
  // to register something nobody wanted.
  const decline = editCommand(
    [`--package=${shellQuote(issue.name)}`, '--decline', `--path=${shellQuote(issue.path)}`],
    [key],
  );
  return `${head}. To register it: ${register}. If it should not be: ${decline}`;
};

/** A relocation, with the path edit that repairs it. The new path comes from the CHECKOUT and is
 * validated before it is printed: a path the configuration cannot hold makes the command a lie,
 * and the finding is still true without it. */
const relocatedLine = (issue: StructureIssue, key: string, at: string): string => {
  const head = `${issue.name}: moved to ${issue.path ?? UNKNOWN_PATH} — update the entry's path (${at})`;
  const repoint = editCommand(
    [`--package=${shellQuote(issue.name)}`],
    [key, 'path', issue.path ?? ''],
  );
  return zPackagePath.safeParse(issue.path).success ? `${head}. To fix it: ${repoint}` : head;
};

/** The four findings about an entry that IS configured — each naming the repair it needs, and the
 * configured path it needs repairing from.
 *
 * Two of them can name a runnable command, and do. The ref key and the package name are the
 * configuration's own, but a ref key admits spaces and `$()` (`zRefKey`) and a package name is
 * checked only for being non-empty — so both go through `shellQuote`, for the reason spelled out
 * above `registrable`, and through `editCommand`, for the second parser they then meet. */
const configuredIssueLine = (issue: StructureIssue, key: string): string => {
  const at = `configured: ${issue.configured_path ?? UNKNOWN_PATH}`;
  if (issue.status === 'relocated') {
    return relocatedLine(issue, key, at);
  }
  if (issue.status === 'missing') {
    const unregister = editCommand([`--package=${shellQuote(issue.name)}`, '--remove'], [key]);
    return (
      `${issue.name}: gone from this repo's workspaces (${at}) — repoint the entry if it moved ` +
      `out of them, or unregister it: ${unregister}`
    );
  }
  if (issue.status === 'ambiguous') {
    const where = (issue.candidates ?? []).join(', ');
    return `${issue.name}: declared at several paths (${where}) — point the entry at one (${at})`;
  }
  return `${issue.name}: could not be checked — ${issue.reason ?? UNKNOWN_REASON} (${at})`;
};

const issueLine = (issue: StructureIssue, key: string): string =>
  issue.status === 'unregistered' ? unregisteredLine(issue, key) : configuredIssueLine(issue, key);

/** One line per thing worth saying, and EMPTY for a clean ref — so a caller can append the result
 * unconditionally and stay silent by construction rather than by remembering to check.
 *
 * `key` is the ref these findings are about; the `unregistered` line puts it into the command it
 * prints, which is what makes that command runnable as it stands. */
const discoveryLine = (reason: string): string =>
  `could not check for unregistered packages — ${reason}`;

const driftLines = (report: StructureReport, key: string): string[] => {
  if (report.reason !== undefined) {
    return [`could not be checked — ${report.reason}`];
  }
  const issues = (report.packages ?? []).map((issue) => issueLine(issue, key));
  return report.discovery_incomplete === undefined
    ? issues
    : [...issues, discoveryLine(report.discovery_incomplete)];
};

export { DRIFT_STATUSES, driftLines, isIssueStatus, rollUp };
export type { DriftStatus, IssueStatus, StructureIssue, StructureReport };
