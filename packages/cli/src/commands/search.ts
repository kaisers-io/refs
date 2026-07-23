import type { GrepMatch, GrepResult, RefEntry, RefKey } from '@kaisers-io/refs-core';
import {
  assertInsideDir,
  checkoutPath,
  grepCheckout,
  notFoundError,
  readConfig,
  resolveHome,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import { emit, wrapAction } from '../output.ts';
import { excludePathspecs, toGlobPathspec } from './search-pathspec.ts';
import {
  parsePositiveLimit,
  requireCheckout,
  requireEntry,
  requirePackage,
} from './ref-context.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { matchRefKey } from './list.ts';

// `refs search <ref> <pattern> [--package <name>] [--limit <n>] [--glob <pattern>]
// [--no-default-excludes]` — a bounded, structured code search over a ref's checkout for coding
// Agents: a hint tool, not a gate. It wraps core's `grepCheckout` (`git grep -z -n -I
// --extended-regexp`), caps the returned matches at `--limit` (default 50), and ALWAYS reports
// `truncated` so an agent knows when more matches exist than it was shown. Build artifacts and
// Lockfiles are filtered by default via git exclude pathspec magic; `--no-default-excludes`
// Lifts that filter, and `excludes_applied` in the output always states exactly what was applied
// (empty when disabled), so nothing is ever filtered invisibly. `--package` is a hard boundary:
// The search runs WITH THE PACKAGE DIRECTORY AS CWD (never by passing the configured path to git
// As a pathspec, where fnmatch metacharacters could expand it), so user `--glob` patterns apply
// Relative to — and strictly inside — the package: absolute and `..`-segment glob patterns are
// Rejected up front (git resolves parent-relative pathspecs against the cwd), and a package
// Directory that physically resolves outside the checkout (symlink) is a containment violation.
// Registered into the command registry via `registrars-extra.ts`, alongside `range.ts`.

interface SearchData {
  excludes_applied: string[];
  key: string;
  match_count: number;
  matches: GrepMatch[];
  package: string | null;
  pattern: string;
  truncated: boolean;
}

interface SearchOptions {
  defaultExcludes: boolean;
  globs: string[];
  limit: number;
  packageName?: string;
}

interface SearchArgs {
  opts: SearchOptions;
  pattern: string;
  query: string;
}

const DEFAULT_LIMIT = 50;
const NO_GLOBS: string[] = [];

// JSON contract: an absent `--package` serializes as an explicit `null`, never a dropped key —
// Mirroring `range.ts`/`resolve.ts`, so agents can branch on the field without existence checks.
// eslint-disable-next-line unicorn/no-null -- see comment above
const JSON_NULL = null;

/** The registered `path` of the named package, or `undefined` when `--package` was not given. An
 * unregistered name is a `notFoundError` (via `requirePackage`), exactly like an unresolvable
 * `<ref>` is. */
const packagePathOf = (
  entry: RefEntry,
  key: RefKey,
  packageName: string | undefined,
): string | undefined => {
  if (packageName === undefined) {
    return undefined;
  }
  return requirePackage(entry, key, packageName).path;
};

/** Where `git grep` runs: the package directory itself when `--package` is given (the boundary
 * is the process cwd — the configured path is NEVER handed to git as a pathspec, so it cannot be
 * interpreted as glob/magic), else the checkout root. A package path of `.` means the whole
 * repo. */
const searchDir = (dest: string, packagePath: string | undefined): string => {
  if (packagePath === undefined || packagePath === '.') {
    return dest;
  }
  return join(dest, packagePath);
};

/** Guards the resolved search directory: a configured package path that is missing from the
 * checkout (config drift, stale checkout) surfaces as a first-class not_found — never as a
 * low-level spawn/cwd error from running git inside a nonexistent directory — and one that
 * exists but PHYSICALLY resolves outside the checkout (a symlinked package directory: checkout
 * content is upstream-controlled, and `existsSync` follows links) is a containment violation
 * via core's `assertInsideDir` — git must never be spawned with an external cwd, possibly a
 * different repository entirely. */
const requireSearchDir = (dir: string, dest: string, key: RefKey): void => {
  // eslint-disable-next-line node/no-sync -- cheap synchronous existence check, mirrors core's isGitCheckout
  if (!existsSync(dir)) {
    throw notFoundError(
      `package path '${dir}' is missing from the checkout — run: refs sync ${key}`,
    );
  }
  if (dir !== dest) {
    assertInsideDir(dest, dir, `checkout for '${key}'`);
  }
};

/** Re-anchors package-relative match paths at the checkout root by plain string join — git never
 * sees (or interprets) the configured package path. */
const prefixMatches = (result: GrepResult, packagePath: string | undefined): GrepResult => {
  if (packagePath === undefined || packagePath === '.') {
    return result;
  }
  const prefixed = result.matches.map((match) => ({
    ...match,
    path: `${packagePath}/${match.path}`,
  }));
  return { matches: prefixed, truncated: result.truncated };
};

interface SearchOutcome {
  excludes: string[];
  key: RefKey;
  result: GrepResult;
}

const orNull = <Value>(value: Value | undefined): Value | null => {
  if (value === undefined) {
    return JSON_NULL;
  }
  return value;
};

const buildSearchData = (args: SearchArgs, outcome: SearchOutcome): SearchData => ({
  excludes_applied: outcome.excludes,
  key: outcome.key,
  match_count: outcome.result.matches.length,
  matches: outcome.result.matches,
  package: orNull(args.opts.packageName),
  pattern: args.pattern,
  truncated: outcome.result.truncated,
});

interface SearchTarget {
  dest: string;
  entry: RefEntry;
  key: RefKey;
}

/** Resolves the query to a configured ref with a present checkout — shared config/checkout
 * plumbing split out of `runSearch` purely for the per-function statement cap. */
const loadSearchTarget = async (ctx: CliContext, query: string): Promise<SearchTarget> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const key = matchRefKey(config, query);
  const entry = requireEntry(config, key);
  const dest = checkoutPath(home, key);
  requireCheckout(dest, key);
  return { dest, entry, key };
};

const runSearch = async (ctx: CliContext, args: SearchArgs): Promise<SearchData> => {
  const { dest, entry, key } = await loadSearchTarget(ctx, args.query);
  const globs = args.opts.globs.map((pattern) => toGlobPathspec(pattern));
  const packagePath = packagePathOf(entry, key, args.opts.packageName);
  const excludes = excludePathspecs(args.opts.defaultExcludes);
  const dir = searchDir(dest, packagePath);
  requireSearchDir(dir, dest, key);
  const raw = await grepCheckout(ctx.runner, {
    dir,
    limit: args.opts.limit,
    pathspecs: [...globs, ...excludes],
    pattern: args.pattern,
  });
  const result = prefixMatches(raw, packagePath);
  return buildSearchData(args, { excludes, key, result });
};

const matchLine = (match: GrepMatch): string => `${match.path}:${match.line}: ${match.snippet}`;

const summaryLine = (data: SearchData): string => {
  if (data.truncated) {
    return `${data.match_count} matches shown (truncated at --limit; more matches exist)`;
  }
  return `${data.match_count} match(es)`;
};

const searchHuman = (data: SearchData): string[] => [
  ...data.matches.map(matchLine),
  summaryLine(data),
];

/** Accumulates repeated `--glob` flags; commander hands the previous array back each time. */
const collectGlob = (value: string, previous: string[]): string[] => [...previous, value];

interface LocalSearchOptions {
  defaultExcludes: boolean;
  glob: string[];
  limit?: string;
  package?: string;
}

// `exactOptionalPropertyTypes` forbids assigning a possibly-`undefined` value directly onto an
// optional property — mirrors `tag.ts`'s `buildTagOptions`.
const buildSearchOptions = (localOpts: LocalSearchOptions): SearchOptions => {
  const opts: SearchOptions = {
    defaultExcludes: localOpts.defaultExcludes,
    globs: localOpts.glob,
    limit: parsePositiveLimit(localOpts.limit, { def: DEFAULT_LIMIT }),
  };
  if (localOpts.package !== undefined) {
    opts.packageName = localOpts.package;
  }
  return opts;
};

const registerSearch = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('search')
    .description('Bounded structured code search (git grep) over a ref checkout.')
    .argument('<ref>', 'full ref key or a unique suffix, e.g. zod')
    .argument('<pattern>', 'extended regular expression, passed to git grep --extended-regexp')
    .option('--package <name>', "scope the search to this package's registered path")
    .option('--limit <n>', `maximum matches to return (default ${DEFAULT_LIMIT})`)
    .option(
      '--glob <pattern>',
      'plain glob pattern to scope the search (repeatable; relative to the package path when --package is given)',
      collectGlob,
      NO_GLOBS,
    )
    .option('--no-default-excludes', 'also search build output, vendored deps, and lockfiles')
    // eslint-disable-next-line max-params -- fixed 4-arg shape commander gives a 2-argument command
    .action((ref, pattern, localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const data = await runSearch(ctx, {
          opts: buildSearchOptions(localOpts),
          pattern,
          query: ref,
        });
        emit(ctx, opts, searchHuman(data), data);
      })();
    });
};

export { registerSearch, runSearch };
export type { SearchData };
