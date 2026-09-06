import { collectPnpmPatterns, parseNpmWorkspaces } from '../workspaces-parse.ts';
import type { Runner } from '../proc/runner.ts';
import { declaresUnreadably } from '../workspaces-declarations.ts';

// Did the repository's workspace DECLARATION change across a range?
//
// `arrivals.ts` establishes which package names existed before a range from two sources: the
// manifests the range changed, read out of history, and the members it did not touch, whose
// current names are also their previous ones because those files are byte-identical at both ends.
// That second half holds only for members the scan can still see. A declaration change breaks it:
// dropping `packages/b` from `workspaces` removes that package from the scan without touching its
// manifest, so the name it carried is remembered by neither source — and a new directory carrying
// the same name would then be announced as an arrival it is not.
//
// The declaration is compared rather than merely checked for a touched file, because a root
// manifest changes constantly (a version bump, a dependency edit) while its `workspaces` field
// almost never does, and suppressing arrivals on every root commit would silence the feature in
// most repositories.
//
// And what matters is specifically whether the declaration NARROWED. Expansion is monotone in the
// set of INCLUSIVE patterns, so adding one leaves every previously visible member visible and the
// inference intact — which is the shape of the commonest arrival there is in a repository that
// lists its members explicitly: the package is added and declared in the same commit.
//
// Negations break that monotonicity, and in the opposite direction: adding `!packages/old`
// narrows just as surely as deleting `packages/old` from the list does, and removing a negation
// widens. So the two kinds are compared separately — an inclusive pattern LOST or a negation
// GAINED means a member may have left the scan with its manifest untouched.

const ROOT_MANIFEST = 'package.json';

/** Stands in for a declaration this reader could not parse. Deliberately unmatchable, so it never
 * compares equal to a real pattern or to an absent declaration. */
const UNREADABLE = '\0unreadable';
const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';
const SUCCESS_EXIT_CODE = 0;

type RangeOpts = {
  dir: string;
  from: string;
  to: string;
};

/** What one file was at one revision. The three cases are genuinely different, and collapsing the
 * last two is what this type exists to prevent: `absent` is a statement about membership — the
 * repository declared nothing there — while `unreadable` is the absence of a statement. Reading a
 * failed `git show` as "declared nothing" makes the old declaration a subset of anything, so a
 * narrowing below it goes unseen and a name that was there all along is announced as new. */
type FileAt = { contents: string } | { kind: 'absent' } | { kind: 'unreadable' };

/** Whether `path` existed at `rev`, asked separately so a failing read cannot be mistaken for a
 * file that was never there. `ls-tree` prints the path when it exists and nothing when it does
 * not, and exits 0 either way; a non-zero exit is a failure to look. */
const existsAt = async (
  runner: Runner,
  opts: { dir: string; path: string; rev: string },
): Promise<boolean | undefined> => {
  const result = await runner.run(
    'git',
    ['ls-tree', '-z', '--name-only', opts.rev, '--', opts.path],
    { cwd: opts.dir },
  );
  return result.exitCode === SUCCESS_EXIT_CODE ? result.stdout.includes(opts.path) : undefined;
};

const showFile = async (
  runner: Runner,
  opts: { dir: string; path: string; rev: string },
): Promise<FileAt> => {
  const present = await existsAt(runner, opts);
  if (present === undefined) {
    return { kind: 'unreadable' };
  }
  if (!present) {
    return { kind: 'absent' };
  }
  const result = await runner.run('git', ['show', `${opts.rev}:${opts.path}`], { cwd: opts.dir });
  return result.exitCode === SUCCESS_EXIT_CODE
    ? { contents: result.stdout }
    : { kind: 'unreadable' };
};

/** The npm-style patterns a root manifest declares, or `[]` when it declares none — including when
 * the file is absent, which is the same statement about membership. */
const npmPatternsAt = async (runner: Runner, opts: RangeOpts, rev: string): Promise<string[]> => {
  const read = await showFile(runner, { dir: opts.dir, path: ROOT_MANIFEST, rev });
  if ('kind' in read) {
    return read.kind === 'absent' ? [] : [UNREADABLE];
  }
  try {
    const data = JSON.parse(read.contents) as Record<string, unknown>;
    return parseNpmWorkspaces(data['workspaces']);
  } catch {
    // Unparsable is not "declares nothing". The sentinel makes the OLD declaration unmatchable, so
    // a range starting from a manifest we cannot read counts as narrowing and gives up — we cannot
    // rule out that it declared something now gone. An unparsable manifest at the new end is the
    // scan's problem rather than this one's, and it reports its own diagnostic.
    return [UNREADABLE];
  }
};

const pnpmPatternsAt = async (runner: Runner, opts: RangeOpts, rev: string): Promise<string[]> => {
  const read = await showFile(runner, { dir: opts.dir, path: PNPM_WORKSPACE_FILE, rev });
  if ('kind' in read) {
    return read.kind === 'absent' ? [] : [UNREADABLE];
  }
  const { contents } = read;
  const patterns = collectPnpmPatterns(contents.split('\n'));
  // A `packages:` key this parser cannot read — flow style, most often — is not a declaration of
  // nothing. Reading it as empty makes any later narrowing invisible: the old declaration compares
  // as a subset of everything, so a member that left the scan looks like it was never there.
  return declaresUnreadably(contents, patterns) ? [UNREADABLE] : patterns;
};

/** Both declarations at one revision, in order. The two files are concatenated because the scanner
 * unions them with no precedence between them (`readDeclarations`), so a pattern MOVED from
 * `package.json` into `pnpm-workspace.yaml` selects the same directories either way.
 *
 * Order is KEPT, unlike before: the scanner honours it, so `["packages/*", "!b", "b"]` and
 * `["packages/*", "b", "!b"]` are the same set and different memberships. */
/** Both declarations at one revision, kept APART and in order.
 *
 * Apart, because the two resolvers disagree: npm lets a later pattern cancel an earlier negation,
 * pnpm does not. Concatenating them hid that — moving `["packages/*", "!b", "b"]` from
 * `package.json` into `pnpm-workspace.yaml` narrows membership, since pnpm keeps the exclusion npm
 * had cancelled, while the joined list compares unchanged.
 *
 * In order, because the scanner honours order: `["packages/*", "!b", "b"]` and
 * `["packages/*", "b", "!b"]` are the same set and different memberships. */
const declarationAt = async (
  runner: Runner,
  opts: RangeOpts,
  rev: string,
): Promise<{ npm: string[]; pnpm: string[] }> => {
  const [npm, pnpm] = await Promise.all([
    npmPatternsAt(runner, opts, rev),
    pnpmPatternsAt(runner, opts, rev),
  ]);
  return { npm, pnpm };
};

const NEGATION_PREFIX = '!';

/** Whether `after` is `before` with inclusive patterns appended, and nothing else.
 *
 * The only change that provably cannot narrow membership. Expansion is monotone in the inclusive
 * patterns, so appending one can only add directories; every other edit — dropping a pattern,
 * adding a negation, or REORDERING, now that order decides which of a negation and a re-inclusion
 * wins — can take a member out of the scan with its manifest untouched, which is the one thing the
 * reconstruction in `arrivals.ts` cannot survive.
 *
 * Deliberately blunt: it calls a widening edit a narrowing whenever the shape is anything else,
 * and the cost of that is a quiet sync rather than a wrong one. */
const onlyAppendedInclusions = (before: readonly string[], after: readonly string[]): boolean => {
  if (after.length < before.length) {
    return false;
  }
  const kept = before.every((pattern, index) => after[index] === pattern);
  const appended = after.slice(before.length);
  return kept && appended.every((pattern) => !pattern.startsWith(NEGATION_PREFIX));
};

/** Whether the range dropped a workspace declaration, so a member could have left the scan with
 * its manifest untouched.
 *
 * Only asked when one of the declaring files was touched at all; callers pass `touched: false` to
 * skip the reads entirely, which is the ordinary case. */
const membershipNarrowed = async (
  runner: Runner,
  opts: RangeOpts & { touched: boolean },
): Promise<boolean> => {
  if (!opts.touched) {
    return false;
  }
  const [before, after] = await Promise.all([
    declarationAt(runner, opts, opts.from),
    declarationAt(runner, opts, opts.to),
  ]);
  // Each file against its own past. A pattern that moved between them fails this, correctly: under
  // the two resolvers' different rules it does not select the same directories.
  return (
    !onlyAppendedInclusions(before.npm, after.npm) ||
    !onlyAppendedInclusions(before.pnpm, after.pnpm)
  );
};

export { PNPM_WORKSPACE_FILE, ROOT_MANIFEST, membershipNarrowed };
