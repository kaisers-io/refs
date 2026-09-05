import type { PackageStatus } from './package-location.ts';
import { shellQuote } from '../shell-quote.ts';

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
const unregisteredLine = (issue: StructureIssue): string => {
  const head = `${issue.name}: declared in this checkout but not registered — it cannot be resolved by name until it is`;
  if (issue.path === undefined) {
    // More than one directory declares this name, so which one to register is a decision, not a
    // lookup. Naming the candidates is the most this can honestly do.
    return `${head}. Declared at several paths (${(issue.candidates ?? []).join(', ')}) — pick one`;
  }
  return (
    `${head}. To register it: refs edit <ref> --package ${shellQuote(issue.name)} --create ` +
    `--path ${shellQuote(issue.path)} --description "<what it is>"`
  );
};

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

export { DRIFT_STATUSES, driftLines, isIssueStatus, rollUp };
export type { DriftStatus, IssueStatus, StructureIssue, StructureReport };
