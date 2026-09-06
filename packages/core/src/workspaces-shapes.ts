// Which workspace-pattern shapes this scanner implements, and what each one means. The decisions
// live here; the filesystem side of every plan runs in `workspaces.ts`. Split from
// `workspaces-patterns.ts`, which keeps the diagnostics vocabulary, for the 300-line cap.

import { isAbsolute } from 'node:path';

/** `match` narrows an `expand-children` plan to the children whose NAME matches a wildcard inside
 * the last segment — `examples/vue/2*` keeps `2.6-basic` and `2.7-basic`, drops `nuxt3`. Absent
 * for a plain `<dir>/*`, which takes every child. */
type WorkspacePatternPlan =
  | { baseDir: string; kind: 'expand-children'; match?: { prefix: string; suffix: string } }
  | { dir: string; kind: 'probe-dir' }
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

const NEGATION_PREFIX = '!';

/** A negation declares which directories are NOT members. It is expanded exactly like an inclusive
 * pattern and the result subtracted (`workspaces.ts#expandPatterns`), so the same shapes are
 * supported on both sides and an unsupported negation reports `unsupported_pattern` like any
 * other — which is the honest answer, since a negation we cannot apply leaves the scan holding
 * directories the repository excluded. */
const isNegatedPattern = (pattern: string): boolean => pattern.startsWith(NEGATION_PREFIX);

/** The pattern a negation negates. Classification only ever sees this, never the `!`. */
const negatedBody = (pattern: string): string => pattern.slice(NEGATION_PREFIX.length);

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
/** Whether a directory name satisfies a partial-segment wildcard. The length guard is what stops
 * `2*` matching a name shorter than its own literal parts, and `a*a` matching `a`. */
const matchesSegment = (name: string, match: { prefix: string; suffix: string }): boolean =>
  name.length >= match.prefix.length + match.suffix.length &&
  name.startsWith(match.prefix) &&
  name.endsWith(match.suffix);

const partialSegmentPlan = (pattern: string): WorkspacePatternPlan => {
  const cut = pattern.lastIndexOf('/');
  const lastSegment = cut === NOT_FOUND ? pattern : pattern.slice(cut + 1);
  if (!lastSegment.includes('*')) {
    return IGNORE;
  }
  const [prefix, suffix] = lastSegment.split('*');
  if (prefix === undefined || suffix === undefined) {
    return IGNORE;
  }
  return {
    baseDir: cut === NOT_FOUND ? CURRENT_DIR_SEGMENT : pattern.slice(0, cut),
    kind: 'expand-children',
    match: { prefix, suffix },
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
    return { baseDir: pattern.slice(0, -GLOB_SUFFIX.length), kind: 'expand-children' };
  }

  if (pattern === BARE_GLOB) {
    return { baseDir: CURRENT_DIR_SEGMENT, kind: 'expand-children' };
  }

  return pattern.includes('*') ? partialSegmentPlan(pattern) : { dir: pattern, kind: 'probe-dir' };
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
const planMatchesPath = (plan: WorkspacePatternPlan, path: string): boolean => {
  if (plan.kind === 'probe-dir') {
    // Normalized on both sides: the exclusion's paths went through this already, and a
    // re-inclusion written `packages/cli/` selects the same directory as `packages/cli` — npm
    // treats them alike, so a trailing slash must not decide whether a package exists.
    return normalizeSeparators(plan.dir) === path;
  }
  if (plan.kind !== 'expand-children') {
    return false;
  }
  const cut = path.lastIndexOf('/');
  const base = cut === NOT_FOUND ? CURRENT_DIR_SEGMENT : path.slice(0, cut);
  const name = cut === NOT_FOUND ? path : path.slice(cut + 1);
  // Normalized on both sides, for the same reason `probe-dir` is: `!packages//*` names the same
  // directories as `!packages/*`, and a repeated separator must not decide whether an exclusion
  // has any effect at all.
  return (
    normalizeSeparators(plan.baseDir) === base &&
    (plan.match === undefined || matchesSegment(name, plan.match))
  );
};

export {
  CURRENT_DIR_SEGMENT,
  PARENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  isNegatedPattern,
  isSafeWorkspacePattern,
  matchesSegment,
  negatedBody,
  normalizeSeparators,
  planMatchesPath,
};
export type { WorkspacePatternPlan };
