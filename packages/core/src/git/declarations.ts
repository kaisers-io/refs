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

/** One file's contents at one revision. `undefined` covers both "not there" and "could not be
 * read" — a distinction that does not matter here, because the caller treats every unreadable
 * declaration the same way it treats a changed one. */
const showFile = async (
  runner: Runner,
  opts: { dir: string; path: string; rev: string },
): Promise<string | undefined> => {
  const result = await runner.run('git', ['show', `${opts.rev}:${opts.path}`], { cwd: opts.dir });
  return result.exitCode === SUCCESS_EXIT_CODE ? result.stdout : undefined;
};

/** The npm-style patterns a root manifest declares, or `[]` when it declares none — including when
 * the file is absent, which is the same statement about membership. */
const npmPatternsAt = async (runner: Runner, opts: RangeOpts, rev: string): Promise<string[]> => {
  const contents = await showFile(runner, { dir: opts.dir, path: ROOT_MANIFEST, rev });
  if (contents === undefined) {
    return [];
  }
  try {
    const data = JSON.parse(contents) as Record<string, unknown>;
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
  const contents = await showFile(runner, { dir: opts.dir, path: PNPM_WORKSPACE_FILE, rev });
  if (contents === undefined) {
    return [];
  }
  const patterns = collectPnpmPatterns(contents.split('\n'));
  // A `packages:` key this parser cannot read — flow style, most often — is not a declaration of
  // nothing. Reading it as empty makes any later narrowing invisible: the old declaration compares
  // as a subset of everything, so a member that left the scan looks like it was never there.
  return declaresUnreadably(contents, patterns) ? [UNREADABLE] : patterns;
};

/** Both declarations at one revision, merged into one order-insensitive set — which is exactly
 * how the scanner reads them (`readDeclarations` unions the two with no precedence between them).
 * Modelling them the same way here matters: keeping the files apart would call a pattern MOVED
 * from `package.json` into `pnpm-workspace.yaml` a narrowing, when it selects the same directories
 * either way. Order is dropped for the same reason. */
const declarationAt = async (
  runner: Runner,
  opts: RangeOpts,
  rev: string,
): Promise<Set<string>> => {
  const [npm, pnpm] = await Promise.all([
    npmPatternsAt(runner, opts, rev),
    pnpmPatternsAt(runner, opts, rev),
  ]);
  return new Set([...npm, ...pnpm]);
};

const lostAny = (before: ReadonlySet<string>, after: ReadonlySet<string>): boolean =>
  [...before].some((pattern) => !after.has(pattern));

const NEGATION_PREFIX = '!';

const split = (patterns: ReadonlySet<string>): { included: Set<string>; negated: Set<string> } => ({
  included: new Set([...patterns].filter((pattern) => !pattern.startsWith(NEGATION_PREFIX))),
  negated: new Set([...patterns].filter((pattern) => pattern.startsWith(NEGATION_PREFIX))),
});

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
  const from = split(before);
  const to = split(after);
  return lostAny(from.included, to.included) || lostAny(to.negated, from.negated);
};

export { PNPM_WORKSPACE_FILE, ROOT_MANIFEST, membershipNarrowed };
