import { CURRENT_DIR, GROUP_AT, commonDir, dirOf } from './drift-group.ts';
import type { StructureIssue, StructureReport } from './drift-report.ts';
import { editCommand, shellQuote } from '../shell-quote.ts';
import { isRegistrablePackageName, zPackagePath } from '@kaisers-io/refs-core';

// How a probe's findings read to a human. Split from `drift-report.ts`, which owns the vocabulary
// and decides the ref's health, for the 300-line cap.
//
// Two kinds of line, and the difference is the point. A finding about a CONFIGURED entry says the
// configuration and the checkout disagree, names the repair and prints the command for it. A
// discovery candidate says only what the checkout declares — it is reported, grouped, and never
// dressed up as something wrong.

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
/** Whether the DECISION can be recorded, which is a weaker question than whether the package can
 * be registered. `packages` is a record keyed by name, so a member legitimately called
 * `constructor` cannot be a key; `declined_packages` is an array of records, so that name is no
 * obstacle at all. The path is: a decline stores one, under the same schema a registration uses.
 *
 * Splitting the two matters most exactly where it is easiest to miss. A finding with no command
 * is the one that recurs forever, so the package whose name cannot be registered is precisely the
 * one that most needs the answer "no, and stop asking". */
const declinable = (issue: StructureIssue): boolean => zPackagePath.safeParse(issue.path).success;

const unregisteredLine = (issue: StructureIssue, key: string): string => {
  const head = `${issue.name}: declared in this checkout but not registered — it cannot be resolved by name until it is`;
  if (issue.path === undefined) {
    // More than one directory declares this name, so which one to register is a decision, not a
    // lookup. Naming the candidates is the most this can honestly do.
    return `${head}. Declared at several paths (${(issue.candidates ?? []).join(', ')}) — pick one`;
  }
  if (!declinable(issue)) {
    return (
      `${head}. Its path is one the configuration cannot hold, so there is no command for it — ` +
      `report it and leave it unregistered`
    );
  }
  // Both answers, because both are answers. Registering is the one that needs a human decision
  // (SKILL.md: never on your own initiative), and declining is what stops the finding returning
  // on every run once that decision was "no" — without it the only way to quieten this line was
  // to register something nobody wanted.
  const decline = editCommand(
    [`--package=${shellQuote(issue.name)}`, '--decline', `--path=${shellQuote(issue.path)}`],
    [key],
  );
  if (!isRegistrablePackageName(issue.name)) {
    return (
      `${head}. Its name is one the packages table cannot hold, so it cannot be registered — ` +
      `if that is the answer, record it: ${decline}`
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

/** How many findings are worth printing in full before the list stops being read.
 *
 * Not a hypothetical limit. A repository declaring `packages/**` can legitimately have hundreds of
 * workspace members — astro has 554, every one of them real, and pnpm agrees — so a ref tracking
 * three of them would otherwise print 551 repair commands into one `doctor` line. The cap is on
 * the PROSE: a report's own `packages` array is untouched, and so is every caller that reads it. */
const MAX_LINES_PER_REF = 10;

/** What the cap held back, and how to reach it.
 *
 * Deliberately NOT a command. The obvious candidate is `refs sync <ref> --json`, and it would be
 * wrong: sync reports only the packages that ARRIVED in the range it fetched, so on an unchanged
 * ref it returns nothing at all and the reader concludes the findings evaporated. `doctor` is the
 * pass that sees everything, and its own output is what was just capped. Acting on the findings
 * above is what reveals the rest, so that is what this says. */
const overflowLine = (hidden: number): string =>
  `…and ${hidden} more finding(s) — act on the ones above (register, repoint or decline) and ` +
  'run the check again to see the rest';

/** The findings, capped, with what the cap hid stated rather than silently dropped. Which ones
 * survive is the order they came in: configured entries are classified before discovery runs, so
 * a problem with a package the ref actually tracks is never crowded out by a list of ones it does
 * not. */
const cap = (lines: readonly string[]): string[] => {
  const hidden = lines.length - MAX_LINES_PER_REF;
  return hidden <= 0 ? [...lines] : [...lines.slice(0, MAX_LINES_PER_REF), overflowLine(hidden)];
};

/** Candidates bucketed by their first path segment, which is where a repository's own layout puts
 * the boundary that matters: `examples` is one answer, `packages` another. */
const byTopLevel = (candidates: readonly StructureIssue[]): Map<string, StructureIssue[]> => {
  const groups = new Map<string, StructureIssue[]>();
  for (const issue of candidates) {
    const [top = CURRENT_DIR] = dirOf(issue.path).split('/');
    groups.set(top, [...(groups.get(top) ?? []), issue]);
  }
  return groups;
};

/** A name declared at SEVERAL paths, which is the whole of that finding. A group names one
 * directory, so folding such a candidate into one drops the other places it was declared — and
 * with them the ambiguity, which is the thing worth reading. It keeps its own line. */
const isAmbiguous = (issue: StructureIssue): boolean => issue.path === undefined;

/** Discovery, grouped by the directory the candidates sit under.
 *
 * Structurally, never by what they look like: a repository's fixtures are packages by every rule
 * the resolvers apply, and refs does not get to label them. The directory says the same thing
 * without a guess — 256 under `packages/astro/test/fixtures` is a reader's answer, and it is the
 * repository's own layout that supplies it.
 *
 * A group with only a couple of candidates keeps its per-package lines, commands and all: those
 * are the ones somebody may actually want to register. */
/** One printed line, and what it stands for. `dir` is carried because a small directory prints one
 * line per package: counting LINES as directories in the overflow then reports two of them where
 * there is one. */
/** One printed line, and what it stands for. `dir` is absent for a name declared in several
 * places: it has no single directory, and inventing one puts a count in the overflow that is not
 * true of anything. */
type DiscoveryGroup = { candidates: number; dir?: string; line: string };

const groupOf = (found: readonly StructureIssue[], key: string, top: string): DiscoveryGroup[] => {
  if (found.length < GROUP_AT) {
    return found.map((issue) => ({ candidates: 1, dir: top, line: unregisteredLine(issue, key) }));
  }
  const dir = commonDir(found.map((issue) => dirOf(issue.path)));
  return [
    {
      candidates: found.length,
      dir,
      line: `${dir}: ${found.length} unregistered package(s) the configuration does not have`,
    },
  ];
};

/** What the cap held back HERE, which is a different sentence from the one about findings.
 *
 * "Act on the ones above" is the instruction for repairs, and a grouped count is not something to
 * act on: it carries no package name and no command. The honest pointer is the machine-readable
 * report, which carries every candidate — and the unit has to be right too, since one hidden group
 * can stand for any number of packages. */
const discoveryOverflow = (groups: readonly DiscoveryGroup[]): string => {
  const packages = groups.reduce((total, group) => total + group.candidates, 0);
  const dirs = new Set(groups.flatMap((group) => (group.dir === undefined ? [] : [group.dir])))
    .size;
  const where = dirs === 0 ? '' : ` in ${dirs} director(ies)`;
  return (
    `…and ${packages} more unregistered package(s)${where} — ` +
    "'refs doctor --json' lists every candidate"
  );
};

/** Discovery, grouped by the directory the candidates sit under.
 *
 * Structurally, never by what they look like: a repository's fixtures are packages by every rule
 * the resolvers apply, and refs does not get to label them. The directory says the same thing
 * without a guess — 256 under `packages/astro/test/fixtures` is a reader's answer, and it is the
 * repository's own layout that supplies it.
 *
 * A group with only a couple of candidates keeps its per-package lines, commands and all: those
 * are the ones somebody may actually want to register. */
const discoveryLines = (candidates: readonly StructureIssue[], key: string): string[] => {
  const alone = candidates
    .filter((issue) => isAmbiguous(issue))
    .map((issue) => ({ candidates: 1, line: unregisteredLine(issue, key) }));
  const grouped = [...byTopLevel(candidates.filter((issue) => !isAmbiguous(issue)))]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([top, found]) => groupOf(found, key, top));
  const groups = [...alone, ...grouped];
  const hidden = groups.slice(MAX_LINES_PER_REF);
  return hidden.length === 0
    ? groups.map((group) => group.line)
    : [...groups.slice(0, MAX_LINES_PER_REF).map((group) => group.line), discoveryOverflow(hidden)];
};

/** One line per thing worth saying, and EMPTY for a clean ref — so a caller can append the result
 * unconditionally and stay silent by construction rather than by remembering to check. */
const driftLines = (report: StructureReport, key: string): string[] => {
  if (report.reason !== undefined) {
    return [`could not be checked — ${report.reason}`];
  }
  return [
    ...cap((report.packages ?? []).map((issue) => issueLine(issue, key))),
    ...discoveryLines(report.discovery ?? [], key),
    ...(report.discovery_incomplete === undefined
      ? []
      : [discoveryLine(report.discovery_incomplete)]),
  ];
};

export { driftLines };
