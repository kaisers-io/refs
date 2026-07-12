import type {
  ChangedPath,
  ChangelogQuery,
  RangeCommit,
  RangeDiffOpts,
  RangeShortstat,
  RefEntry,
  RefKey,
} from '@kaisers-io/refs-core';
import {
  changelogAtTag,
  checkoutPath,
  countRangeCommits,
  listRangeCommits,
  rangeNameStatus,
  rangeShortstat,
  readConfig,
  resolveHome,
  resolveTag,
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

// `refs range <ref> <old-version> <new-version> [--package <name>] [--limit <n>]` — a
// Token-efficient version-diff digest for coding agents: both versions resolve to git tags
// Exactly like `refs tag` does (including the `package.tag_format ?? ref.tag_format` inheritance
// Rule), then bounded read-only git queries (core's git/range.ts + changelog.ts) produce ONE
// Envelope with the commit log, diff stats, changed paths, and a capped CHANGELOG excerpt.
// `truncated` is ALWAYS present so an agent can tell that more data exists beyond every bound —
// A hard design requirement, never an optional nicety. With `--package`, the diff/changed-paths
// Queries are additionally scoped to the package's configured `path`.

const DEFAULT_COMMIT_LIMIT = 50;
const CHANGED_PATHS_LIMIT = 200;
const CHANGELOG_MAX_CHARS = 4000;

// JSON contract: an absent package/changelog serializes as an explicit `null`, never a dropped
// Key — agents can then branch on the field without existence checks.
// eslint-disable-next-line unicorn/no-null -- see comment above
const JSON_NULL = null;

interface RangeEndpoint {
  tag: string;
  version: string;
}

interface RangeData {
  changed_paths: ChangedPath[];
  changelog: string | null;
  commit_count: number;
  commits: RangeCommit[];
  diff: RangeShortstat;
  key: string;
  new: RangeEndpoint;
  old: RangeEndpoint;
  package: string | null;
  truncated: { changelog: boolean; commits: boolean; paths: boolean };
}

interface RangeOptions {
  limit: number;
  packageName?: string;
}

interface RangeArgs {
  newVersion: string;
  oldVersion: string;
  opts: RangeOptions;
  query: string;
}

interface PackageScope {
  format: string;
  path?: string;
}

/** Resolves the tag_format AND diff path scope for the request: `--package` uses the package's
 * own `tag_format` when set, else inherits the ref's (spec §3, exactly like `tag.ts`'s
 * `formatFor`), and contributes its configured `path` as the diff scope. An unregistered package
 * name is a `notFoundError` (via `requirePackage`), exactly like an unresolvable `<ref>`. */
const packageScope = (
  entry: RefEntry,
  key: RefKey,
  packageName: string | undefined,
): PackageScope => {
  if (packageName === undefined) {
    return { format: entry.tag_format };
  }
  const pkg = requirePackage(entry, key, packageName);
  return { format: pkg.tag_format ?? entry.tag_format, path: pkg.path };
};

interface DigestOpts {
  dest: string;
  limit: number;
  newTag: string;
  oldTag: string;
  packagePath?: string;
}

interface Digest {
  commitCount: number;
  commits: RangeCommit[];
  diff: RangeShortstat;
  paths: { paths: ChangedPath[]; truncated: boolean };
}

// `exactOptionalPropertyTypes` forbids assigning a possibly-`undefined` value directly onto an
// Optional property — hence the conditional builders here and below.
const diffScope = (opts: DigestOpts): RangeDiffOpts => {
  const scope: RangeDiffOpts = { newTag: opts.newTag, oldTag: opts.oldTag };
  if (opts.packagePath !== undefined) {
    scope.pathScope = opts.packagePath;
  }
  return scope;
};

// The four range queries are independent read-only lookups against the same checkout — run them
// Concurrently rather than serially.
const collectDigest = async (ctx: CliContext, opts: DigestOpts): Promise<Digest> => {
  const bounds = { newTag: opts.newTag, oldTag: opts.oldTag };
  const scope = diffScope(opts);
  const [commitCount, commits, diff, paths] = await Promise.all([
    countRangeCommits(ctx.runner, opts.dest, bounds),
    listRangeCommits(ctx.runner, opts.dest, { ...bounds, limit: opts.limit }),
    rangeShortstat(ctx.runner, opts.dest, scope),
    rangeNameStatus(ctx.runner, opts.dest, { ...scope, limit: CHANGED_PATHS_LIMIT }),
  ]);
  return { commitCount, commits, diff, paths };
};

interface BuildOpts {
  args: RangeArgs;
  dest: string;
  key: RefKey;
  newTag: string;
  oldTag: string;
  scope: PackageScope;
}

const changelogQuery = (build: BuildOpts): ChangelogQuery => {
  const query: ChangelogQuery = {
    maxChars: CHANGELOG_MAX_CHARS,
    newTag: build.newTag,
    newVersion: build.args.newVersion,
    oldVersion: build.args.oldVersion,
  };
  if (build.scope.path !== undefined) {
    query.packagePath = build.scope.path;
  }
  return query;
};

const digestOpts = (build: BuildOpts): DigestOpts => {
  const opts: DigestOpts = {
    dest: build.dest,
    limit: build.args.opts.limit,
    newTag: build.newTag,
    oldTag: build.oldTag,
  };
  if (build.scope.path !== undefined) {
    opts.packagePath = build.scope.path;
  }
  return opts;
};

const orNull = <Value>(value: Value | undefined): Value | null => {
  if (value === undefined) {
    return JSON_NULL;
  }
  return value;
};

const buildRangeData = async (ctx: CliContext, build: BuildOpts): Promise<RangeData> => {
  // The changelog lookup needs only `newTag` (known before any digest query runs), so it joins
  // The digest's read-only query wave instead of serializing after it.
  const [digest, changelog] = await Promise.all([
    collectDigest(ctx, digestOpts(build)),
    changelogAtTag(ctx.runner, build.dest, changelogQuery(build)),
  ]);
  return {
    changed_paths: digest.paths.paths,
    changelog: orNull(changelog?.excerpt),
    commit_count: digest.commitCount,
    commits: digest.commits,
    diff: digest.diff,
    key: build.key,
    new: { tag: build.newTag, version: build.args.newVersion },
    old: { tag: build.oldTag, version: build.args.oldVersion },
    package: orNull(build.args.opts.packageName),
    truncated: {
      changelog: changelog?.truncated ?? false,
      commits: digest.commitCount > digest.commits.length,
      paths: digest.paths.truncated,
    },
  };
};

const runRange = async (ctx: CliContext, args: RangeArgs): Promise<RangeData> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const key = matchRefKey(config, args.query);
  const entry = requireEntry(config, key);
  const scope = packageScope(entry, key, args.opts.packageName);
  const dest = checkoutPath(home, key);
  requireCheckout(dest, key);
  // Two independent read-only tag lookups against the same checkout — resolved concurrently.
  const [oldTag, newTag] = await Promise.all([
    resolveTag(ctx.runner, dest, scope.format, args.oldVersion),
    resolveTag(ctx.runner, dest, scope.format, args.newVersion),
  ]);
  return buildRangeData(ctx, { args, dest, key, newTag, oldTag, scope });
};

const changelogLine = (data: RangeData): string => {
  if (data.changelog === JSON_NULL) {
    return 'changelog: not found';
  }
  if (data.truncated.changelog) {
    return 'changelog: found (truncated)';
  }
  return 'changelog: found';
};

const rangeHuman = (data: RangeData): string[] => [
  `${data.key}: ${data.old.tag} -> ${data.new.tag}`,
  `commits: ${data.commit_count} (showing ${data.commits.length})`,
  `files changed: ${data.diff.files_changed} (+${data.diff.insertions} -${data.diff.deletions})`,
  changelogLine(data),
];

const buildRangeOptions = (localOpts: { limit?: string; package?: string }): RangeOptions => {
  const opts: RangeOptions = {
    limit: parsePositiveLimit(localOpts.limit, { def: DEFAULT_COMMIT_LIMIT }),
  };
  if (localOpts.package !== undefined) {
    opts.packageName = localOpts.package;
  }
  return opts;
};

const registerRange = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('range')
    .description('Digest of what changed between two versions of a ref: commits, diff, changelog.')
    .argument('<ref>', 'full ref key or a unique suffix, e.g. zod')
    .argument('<old-version>', 'older version, e.g. 4.0.0')
    .argument('<new-version>', 'newer version, e.g. 4.1.0')
    .option('--package <name>', "resolve tags via this package's tag_format and scope the diff")
    .option('--limit <n>', `maximum commits to list (default ${String(DEFAULT_COMMIT_LIMIT)})`)
    // eslint-disable-next-line max-params -- fixed 5-arg shape commander gives a 3-argument command
    .action((ref, oldVersion, newVersion, localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const data = await runRange(ctx, {
          newVersion,
          oldVersion,
          opts: buildRangeOptions(localOpts),
          query: ref,
        });
        emit(ctx, opts, rangeHuman(data), data);
      })();
    });
};

export { registerRange, runRange };
export type { RangeData };
