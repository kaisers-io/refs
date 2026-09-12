// Which workspace-pattern shapes this scanner implements, and what each one means. The decisions
// live here; the filesystem side of every plan runs in `workspaces.ts`. Split from
// `workspaces-patterns.ts`, which keeps the diagnostics vocabulary, for the 300-line cap.
import { isAbsolute } from 'node:path';
import { minimatch } from 'minimatch';

/** What this scanner will do with one pattern, plus the pattern itself.
 *
 * The plan decides WALKING — which directory to read, or which single path to probe. Whether a
 * given path matches is not decided here at all: `pattern` is carried through so `minimatch`
 * answers that, on the original text rather than on anything reconstructed from the plan. */
/** The expand-one-level plan, named because three files pass it around and all of them need the
 * suffix to agree. */
type WildcardPlan = { baseDir: string; kind: 'expand-children'; pattern: string; suffix: string };

type WorkspacePatternPlan =
  | WildcardPlan
  | { dir: string; kind: 'probe-dir'; pattern: string }
  | { kind: 'ignore' };

const CURRENT_DIR_SEGMENT = '.';
const PARENT_DIR_SEGMENT = '..';
const PATH_SEGMENT_SEPARATOR_PATTERN = /[/\\]/u;
const MAX_WILDCARDS_PER_PATTERN = 1;

const IGNORE: WorkspacePatternPlan = { kind: 'ignore' };
const NOT_FOUND = -1;

// Reject any workspace pattern that is absolute or contains `.`/`..` path segments before
// it is ever used in a filesystem call. Defense in depth; `isContainedInRepo` in
// `workspaces.ts` still re-checks each resolved candidate via realpath.
const isSafeWorkspacePattern = (pattern: string): boolean => {
  if (isAbsolute(pattern)) {
    return false;
  }

  const segments = pattern.split(PATH_SEGMENT_SEPARATOR_PATTERN);
  return segments.every(
    (segment) => segment !== CURRENT_DIR_SEGMENT && segment !== PARENT_DIR_SEGMENT,
  );
};

const LEADING_EXCLAMATIONS = /^!+/u;
const PAIR = 2;
const ODD = 1;
const LEADING_CURRENT_DIR = /^\.?\/+/u;

/** One declared pattern, stripped the way both resolvers strip it.
 *
 * Two rules, both from npm's `appendNegatedPatterns` and both confirmed against pnpm as well:
 *
 *   - EVERY leading `!` comes off, and an ODD count means exclusion. `!!packages/cli` is an
 *     inclusion, not an exclusion of `!packages/cli` — leaving one mark on would hand minimatch a
 *     negated pattern of its own, which matches everything EXCEPT that directory.
 *   - A leading `./` or `/` comes off, of positive and negated patterns alike, so
 *     `!./packages/cli` rules out the directory it names. */
const parsePattern = (pattern: string): { body: string; negated: boolean } => {
  const marks = LEADING_EXCLAMATIONS.exec(pattern)?.[0] ?? '';
  return {
    body: pattern.slice(marks.length).replace(LEADING_CURRENT_DIR, ''),
    negated: marks.length % PAIR === ODD,
  };
};

const isNegatedPattern = (pattern: string): boolean => parsePattern(pattern).negated;

/** What a pattern names, with the marks and any leading `./` removed. Classification and matching
 * only ever see this, never the raw declaration. */
const negatedBody = (pattern: string): string => parsePattern(pattern).body;

/** Glob syntax this expander does not implement — character classes, braces, and the extglob forms
 * `@(a|b)`, `+(a)`, `!(a)`, `?(a)`, `*(a)`, every one of which is a character followed by `(`.
 *
 * Left unrecognized, `packages/{a,b}` reads as a directory literally named `{a,b}`: the probe finds
 * nothing, and — with no diagnostic — the scan looks complete. Harmless while a pattern only ADDS (a match nobody found is a package nobody
 * registers), but a negation that silently expands to nothing leaves the scan holding directories
 * the repository excluded, with nothing to say so. Reporting the shape is what makes that
 * visible. */
const UNSUPPORTED_GLOB_SYNTAX = /[?[\]{}()]/u;

// A pattern is supported only when it is safe, uses no syntax beyond a single `*`, and stays
// within the wildcard budget (v1 simplification). The check order preserves the original
// precedence.
//
// A raw negation is still rejected here, even though negations ARE applied now: this function
// classifies the pattern it is given, and `!packages/b` as a literal would name a directory called
// `!packages`. `expandPatterns` strips the `!` and passes the body, so the guard only ever catches
// a caller that forgot to.
const isSupportedPatternShape = (pattern: string): boolean =>
  isSafeWorkspacePattern(pattern) &&
  !isNegatedPattern(pattern) &&
  !pattern.includes('**') &&
  !UNSUPPORTED_GLOB_SYNTAX.test(pattern) &&
  (pattern.match(/\*/gu) ?? []).length <= MAX_WILDCARDS_PER_PATTERN;

/** Whether `path` matches `pattern`, answered by the matcher npm itself uses.
 *
 * Hand-written matching produced five defects across as many review rounds — extglob read as a
 * literal, trailing slashes treated symmetrically (`minimatch('a/', 'a')` is true while
 * `minimatch('a', 'a/')` is false), repeated separators silently matching nothing. Every one was a
 * disagreement with the resolver whose declaration was being read, and none was a disagreement
 * about walking the filesystem, which stays here.
 *
 * One matcher covers both ecosystems: pnpm matches through picomatch, but normalizes first, and
 * was measured to agree with minimatch on every shape this scanner supports. */
const matchesPattern = (path: string, pattern: string): boolean => minimatch(path, pattern);

/** A package path is an identifier, not a filesystem string: it is compared against configured
 * entries, against the paths git reports, and printed into commands `zPackagePath` must accept —
 * and `zPackagePath` rejects both a trailing slash and an empty segment. A literal declaration
 * keeps whatever the repository wrote, and `packages//new/` is as legal to npm and pnpm as
 * `packages/new`, so separators are collapsed and trimmed where the pattern becomes a path.
 *
 * Written out rather than delegated to `posix.normalize`, which also resolves `.` and `..`
 * segments — a traversal-shaped pattern is rejected upstream as unsafe, and quietly resolving one
 * here would be a second, weaker answer to a question already decided.
 *
 * The glob branch needs no equivalent: it builds its paths with `posix.join`, which normalizes. */
const normalizeSeparators = (dir: string): string =>
  dir.replaceAll(/\/+/gu, '/').replace(/\/$/u, '');

// Splits a single-wildcard pattern around the segment that holds the wildcard.
//
// Everything BEFORE that segment is the directory to expand, one level. Everything AFTER it is a
// literal suffix appended to each child when probing and when matching. `packages/*` and a bare
// `*` are this with an empty suffix, so they need no branch of their own.
//
// `crates/*/js` is one `readdir` of `crates/` plus a literal probe per child — the same shape as
// `packages/*`, and the reason the wildcard's position never mattered. It was rejected on the
// grounds that an earlier wildcard "would mean expanding more than one level", which is what a
// SECOND wildcard would mean; `packages/*/nested/*` is still refused, by the wildcard budget that
// exists for it. Real repositories declare the first shape: `vercel/next.js` writes `crates/*/js`
// and `turbopack/crates/*/js`, and four published packages sat behind them unseen.
const wildcardSegmentPlan = (pattern: string): WorkspacePatternPlan => {
  const segments = normalizeSeparators(pattern).split('/');
  const at = segments.findIndex((segment) => segment.includes('*'));
  if (at === NOT_FOUND) {
    return IGNORE;
  }
  return {
    baseDir: at === 0 ? CURRENT_DIR_SEGMENT : segments.slice(0, at).join('/'),
    kind: 'expand-children',
    // The NORMALIZED pattern, not the declared one. A candidate path is built from the normalized
    // segments, and minimatch treats a trailing separator asymmetrically — `packages/core` does
    // not match `packages/*/` — so carrying the raw pattern here selected nothing and reported
    // nothing, which is worse than the `unsupported_pattern` this shape used to get. The declared
    // text is still what a diagnostic names (`expandGlobPattern`).
    pattern: normalizeSeparators(pattern),
    suffix: segments.slice(at + 1).join('/'),
  };
};

// Two outcomes for a supported pattern: one holding a wildcard expands its base a single level,
// and a wildcard-free one probes a single literal directory. `<dir>/*`, a bare `*`,
// `examples/vue/2*` and `crates/*/js` are all the first case — they differ only in where the
// wildcard sits and what literal follows it, which `wildcardSegmentPlan` reads off the pattern.
const classifyWorkspacePattern = (pattern: string): WorkspacePatternPlan => {
  if (!isSupportedPatternShape(pattern)) {
    return IGNORE;
  }

  return pattern.includes('*')
    ? wildcardSegmentPlan(pattern)
    : { dir: pattern, kind: 'probe-dir', pattern };
};

/** Whether an already-classified inclusive pattern selects `path` — decided from the plan alone,
 * with no filesystem access, so an exclusion can be tested against later patterns before anything
 * is probed. */
/** Whether an already-classified pattern selects `path`.
 *
 * The plan carries the ORIGINAL pattern so matching stays minimatch's job; classification only
 * decides whether this scanner is willing to expand that shape at all, which is a question about
 * walking cost rather than about matching. */
const planMatchesPath = (plan: WorkspacePatternPlan, path: string): boolean =>
  plan.kind === 'ignore' ? false : matchesPattern(path, plan.pattern);

export {
  CURRENT_DIR_SEGMENT,
  PARENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  isNegatedPattern,
  isSafeWorkspacePattern,
  matchesPattern,
  negatedBody,
  normalizeSeparators,
  planMatchesPath,
};
export type { WildcardPlan, WorkspacePatternPlan };
