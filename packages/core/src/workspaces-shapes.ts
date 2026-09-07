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
type WorkspacePatternPlan =
  | { baseDir: string; kind: 'expand-children'; pattern: string }
  | { dir: string; kind: 'probe-dir'; pattern: string }
  | { kind: 'ignore' };

const GLOB_SUFFIX = '/*';
const BARE_GLOB = '*';
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

/** A wildcard INSIDE the last segment: `examples/vue/2*`, `pkg-*`, `*-utils`.
 *
 * Real repositories use this shape for exclusions — TanStack Query writes `!examples/vue/2*` and
 * `!examples/vue/nuxt*` — and a negation nobody can expand leaves the scan holding directories the
 * repository excluded, which costs every finding about the repository rather than just those two
 * directories. Supported for inclusive patterns too, since the two sides go through one expander.
 *
 * Only the LAST segment may hold the wildcard; one in an earlier segment would mean expanding
 * more than one level, which this scanner deliberately does not do. */
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

const partialSegmentPlan = (pattern: string): WorkspacePatternPlan => {
  const cut = pattern.lastIndexOf('/');
  const lastSegment = cut === NOT_FOUND ? pattern : pattern.slice(cut + 1);
  if (!lastSegment.includes('*')) {
    return IGNORE;
  }
  return {
    baseDir: cut === NOT_FOUND ? CURRENT_DIR_SEGMENT : pattern.slice(0, cut),
    kind: 'expand-children',
    pattern,
  };
};

// Flat dispatch over the supported glob forms; the check order IS the precedence order:
// `<dir>/*` and bare `*` expand one level (bare `*`, a flat workspaces layout, expands the repo
// root `.` as glob base, same as `<dir>/*`), a wildcard-free pattern probes a single literal
// directory, and any other wildcard placement is ignored.
const classifyWorkspacePattern = (pattern: string): WorkspacePatternPlan => {
  if (!isSupportedPatternShape(pattern)) {
    return IGNORE;
  }

  if (pattern.endsWith(GLOB_SUFFIX)) {
    return { baseDir: pattern.slice(0, -GLOB_SUFFIX.length), kind: 'expand-children', pattern };
  }

  if (pattern === BARE_GLOB) {
    return { baseDir: CURRENT_DIR_SEGMENT, kind: 'expand-children', pattern };
  }

  return pattern.includes('*')
    ? partialSegmentPlan(pattern)
    : { dir: pattern, kind: 'probe-dir', pattern };
};

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
export type { WorkspacePatternPlan };
