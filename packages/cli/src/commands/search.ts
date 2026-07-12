import type { Config, GrepMatch, GrepResult, RefEntry, RefKey } from '@kaisers-io/refs-core';
import {
  checkoutPath,
  grepCheckout,
  isGitCheckout,
  notFoundError,
  readConfig,
  resolveHome,
  usageError,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import { emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { matchRefKey } from './list.ts';

// `refs search <ref> <pattern> [--package <name>] [--limit <n>] [--glob <pathspec>]
// [--no-default-excludes]` — a bounded, structured code search over a ref's checkout for coding
// Agents: a hint tool, not a gate. It wraps core's `grepCheckout` (`git grep -n -I
// --extended-regexp`), caps the returned matches at `--limit` (default 50), and ALWAYS reports
// `truncated` so an agent knows when more matches exist than it was shown. Build artifacts and
// Lockfiles are filtered by default via `:(exclude)` pathspec magic; `--no-default-excludes`
// Lifts that filter, and `excludes_applied` in the output always states exactly what was applied
// (empty when disabled), so nothing is ever filtered invisibly. NOTE: deliberately not wired into
// `registry.ts`/`registrars-more.ts` yet — the orchestrator adds the registration separately.

interface SearchData {
  excludes_applied: string[];
  key: string;
  match_count: number;
  matches: GrepMatch[];
  package?: string;
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
const MIN_LIMIT = 1;
const NO_GLOBS: string[] = [];

// Directories and file patterns a coding agent almost never wants grep hits from: build output,
// Vendored/installed dependencies, coverage reports, minified bundles, and lockfiles. Applied as
// `:(exclude)` pathspec-magic entries (git's own exclude syntax) unless `--no-default-excludes`.
const DEFAULT_EXCLUDES = [
  'dist',
  'build',
  'out',
  'vendor',
  'node_modules',
  'coverage',
  '*.min.*',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;

// Returns the exact pathspec entries handed to git — the same strings surfaced verbatim as
// `excludes_applied`, so the agent sees precisely what was filtered, not a paraphrase of it.
const excludePathspecs = (defaultExcludes: boolean): string[] => {
  if (!defaultExcludes) {
    return [];
  }
  return DEFAULT_EXCLUDES.map((entry) => `:(exclude)${entry}`);
};

// `matchRefKey` only ever returns a key it found among `Object.keys(config.refs)`, so this lookup
// can never actually miss — the throw exists purely to satisfy `noUncheckedIndexedAccess`,
// mirroring `show.ts`/`tag.ts`'s `requireEntry`.
const requireEntry = (config: Config, key: RefKey): RefEntry => {
  const entry = config.refs[key];
  if (entry === undefined) {
    throw new Error(`internal: matched ref key '${key}' is missing from config.refs`);
  }
  return entry;
};

/** Guards against a configured ref whose checkout directory is missing — first-class state
 * elsewhere (`refs list` reports it, `refs sync` repairs it) that would otherwise surface here as
 * a low-level git/cwd error out of `grepCheckout`. Mirrors `tag.ts`'s `requireCheckout`. */
const requireCheckout = (dest: string, key: RefKey): void => {
  if (!isGitCheckout(dest)) {
    throw notFoundError(`checkout for '${key}' is missing — run: refs sync ${key}`);
  }
};

/** The pathspec scoping the search to the named package's registered `path`, or none when
 * `--package` was not given. An unregistered name is a `notFoundError`, exactly like an
 * unresolvable `<ref>` is — mirroring `tag.ts`'s `formatFor`. */
const packageScope = (entry: RefEntry, key: RefKey, packageName: string | undefined): string[] => {
  if (packageName === undefined) {
    return [];
  }
  const pkg = entry.packages?.[packageName];
  if (pkg === undefined) {
    throw notFoundError(`no package '${packageName}' registered on ref '${key}'`);
  }
  return [pkg.path];
};

interface SearchOutcome {
  excludes: string[];
  key: RefKey;
  result: GrepResult;
}

// `exactOptionalPropertyTypes` forbids assigning a possibly-`undefined` value onto the optional
// `package` property, so it is only set when `--package` was actually given — an unscoped
// Search's envelope simply omits the field (never `null`, per repo style).
const buildSearchData = (args: SearchArgs, outcome: SearchOutcome): SearchData => {
  const data: SearchData = {
    excludes_applied: outcome.excludes,
    key: outcome.key,
    match_count: outcome.result.matches.length,
    matches: outcome.result.matches,
    pattern: args.pattern,
    truncated: outcome.result.truncated,
  };
  if (args.opts.packageName !== undefined) {
    data.package = args.opts.packageName;
  }
  return data;
};

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

// Deliberately parsed here rather than via commander's parseArg seam: throwing in a parseArg
// Surfaces as a CommanderError, not the standard usage-error envelope — parsing inside the action
// Keeps a bad `--limit` on `wrapAction`'s ordinary error-rendering path.
const parseLimit = (raw: string | undefined): number => {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < MIN_LIMIT) {
    throw usageError(`--limit must be a positive integer, got '${raw}'`);
  }
  return limit;
};

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
    limit: parseLimit(localOpts.limit),
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
