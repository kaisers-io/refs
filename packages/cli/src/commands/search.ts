import type { GrepMatch, GrepResult, RefEntry, RefKey } from '@kaisers-io/refs-core';
import {
  checkoutPath,
  grepCheckout,
  readConfig,
  resolveHome,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import { emit, wrapAction } from '../output.ts';
import {
  parsePositiveLimit,
  requireCheckout,
  requireEntry,
  requirePackage,
} from './ref-context.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { matchRefKey } from './list.ts';

// `refs search <ref> <pattern> [--package <name>] [--limit <n>] [--glob <pathspec>]
// [--no-default-excludes]` — a bounded, structured code search over a ref's checkout for coding
// Agents: a hint tool, not a gate. It wraps core's `grepCheckout` (`git grep -n -I
// --extended-regexp`), caps the returned matches at `--limit` (default 50), and ALWAYS reports
// `truncated` so an agent knows when more matches exist than it was shown. Build artifacts and
// Lockfiles are filtered by default via git exclude pathspec magic; `--no-default-excludes`
// Lifts that filter, and `excludes_applied` in the output always states exactly what was applied
// (empty when disabled), so nothing is ever filtered invisibly. Registered into the command
// Registry via `registrars-extra.ts`, alongside `range.ts`.

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

/** The pathspec scoping the search to the named package's registered `path`, or none when
 * `--package` was not given. An unregistered name is a `notFoundError` (via `requirePackage`),
 * exactly like an unresolvable `<ref>` is. */
const packageScope = (entry: RefEntry, key: RefKey, packageName: string | undefined): string[] => {
  if (packageName === undefined) {
    return [];
  }
  return [requirePackage(entry, key, packageName).path];
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

const runSearch = async (ctx: CliContext, args: SearchArgs): Promise<SearchData> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const key = matchRefKey(config, args.query);
  const entry = requireEntry(config, key);
  const dest = checkoutPath(home, key);
  requireCheckout(dest, key);
  const excludes = excludePathspecs(args.opts.defaultExcludes);
  const result = await grepCheckout(ctx.runner, {
    dir: dest,
    limit: args.opts.limit,
    pathspecs: [
      ...packageScope(entry, key, args.opts.packageName),
      ...args.opts.globs,
      ...excludes,
    ],
    pattern: args.pattern,
  });
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
      '--glob <pathspec>',
      'additional git pathspec to scope the search (repeatable)',
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
