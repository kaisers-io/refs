import { usageError } from '@kaisers-io/refs-core';

// Pathspec construction for `refs search`, split out of `search.ts` purely for the repo's
// 300-line file cap: the default exclude list handed to `git grep` and the `--glob`
// Validation/wrapping rules. Everything here is pure string work — no fs, no git.

// Directories and file patterns a coding agent almost never wants grep hits from: build output,
// Vendored/installed dependencies, coverage reports, minified bundles, and lockfiles. Three
// Shapes, each verified against real git pathspec semantics:
// - directory names use `:(glob,exclude)**/<dir>/**` so NESTED occurrences
//   (`packages/foo/dist/…`) are filtered too — a bare `:(exclude)dist` only matches the
//   repo-root directory, and glob's leading `**/` also matches at the root, so one pattern
//   covers both;
// - wildcard file patterns stay bare `:(exclude)` — fnmatch's `*` crosses `/`, so `*.lock`
//   already matches `packages/foo/nested.lock`;
// - literal file names need the same `**/` glob treatment as directories — a bare
//   `:(exclude)package-lock.json` only matches at the repo root.
const EXCLUDED_DIRS = ['dist', 'build', 'out', 'vendor', 'node_modules', 'coverage'] as const;
const EXCLUDED_FILE_WILDCARDS = ['*.min.*', '*.lock'] as const;
const EXCLUDED_FILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'] as const;

const DEFAULT_EXCLUDE_PATHSPECS: readonly string[] = [
  ...EXCLUDED_DIRS.map((dir) => `:(glob,exclude)**/${dir}/**`),
  ...EXCLUDED_FILE_WILDCARDS.map((pattern) => `:(exclude)${pattern}`),
  ...EXCLUDED_FILE_NAMES.map((name) => `:(glob,exclude)**/${name}`),
];

// Returns the exact pathspec entries handed to git — the same strings surfaced verbatim as
// `excludes_applied`, so the agent sees precisely what was filtered, not a paraphrase of it.
const excludePathspecs = (defaultExcludes: boolean): string[] => {
  if (!defaultExcludes) {
    return [];
  }
  return [...DEFAULT_EXCLUDE_PATHSPECS];
};

// `--glob` accepts a PLAIN glob pattern, never raw pathspec magic: a leading `:` is rejected so
// A caller can never smuggle `:(exclude)`/`:(top)`/... through, and the accepted pattern is
// Wrapped as `:(glob)<pattern>` ourselves (glob semantics: `*` stops at `/`, `**` crosses it).
// The pattern must also stay INSIDE the search root: git resolves parent-relative pathspecs
// Against the cwd, so an absolute pattern or a `..` PATH SEGMENT (`../x`, `a/../b`) would
// Silently escape the `--package` hard boundary. Checked per `/`-split segment, never by
// Substring — a name like `a..b` is a legal glob and stays accepted.
const PATHSPEC_MAGIC_PREFIX = ':';
const ABSOLUTE_PATTERN_PREFIX = '/';
const PARENT_SEGMENT = '..';

const escapesSearchRoot = (pattern: string): boolean =>
  pattern.startsWith(ABSOLUTE_PATTERN_PREFIX) || pattern.split('/').includes(PARENT_SEGMENT);

const toGlobPathspec = (pattern: string): string => {
  if (pattern.startsWith(PATHSPEC_MAGIC_PREFIX)) {
    throw usageError('--glob takes a plain glob pattern, not a git pathspec');
  }
  if (escapesSearchRoot(pattern)) {
    throw usageError(
      "--glob takes a pattern inside the search root, not an absolute path or a '..' segment",
    );
  }
  return `:(glob)${pattern}`;
};

export { excludePathspecs, toGlobPathspec };
