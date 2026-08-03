import type {
  CloneMode,
  Config,
  RefEntry,
  RefKey,
  RefsHome,
  Settings,
  State,
} from '@kaisers-io/refs-core';
import {
  checkoutPath,
  durationToMs,
  isGitCheckout,
  notFoundError,
  readConfig,
  readState,
  resolveHome,
  resolveSetting,
  usageError,
  zRefKey,
} from '@kaisers-io/refs-core';
import { cliOptsOf, emit, wrapAction } from '../output.ts';
import { isStale, statusLines } from './ref-status.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';

// `refs list` prints one row per configured ref with resolved staleness/missing status. This file
// also exports `matchRefKey`, the suffix-matching resolver `show`/`sync`/`edit`/`remove`/`tag`/
// `resolve` reuse to turn a full ref key or a unique suffix into an exact key. The
// staleness check itself (`isStale`) lives in `ref-status.ts`, shared with `sync.ts`'s
// `--stale-only` filter.

type ListItem = {
  clone_mode: CloneMode;
  description: string;
  key: string;
  last_fetched_at?: string;
  missing: boolean;
  packages?: string[];
  packages_count: number;
  stale: boolean;
};

type ListArgs = {
  config: Config;
  home: RefsHome;
  includePackages: boolean;
  now: number;
  state: State;
};

type ItemArgs = {
  home: RefsHome;
  includePackages: boolean;
  now: number;
  settings: Settings;
  state: State;
};

// `packages` is omitted unless `--packages` was passed: a monorepo ref can carry 140 package
// names, and no consumer in this repo reads them off `list` output — `resolve` does package
// matching internally against the config, and `listHuman` never touched the field. The count
// stays so a caller can still tell "monorepo" from "single package" for free.
const buildListItem = (args: ItemArgs, key: string, ref: RefEntry): ListItem => {
  const refState = args.state.refs[key];
  const ttlMs = durationToMs(resolveSetting('sync_ttl', ref, args.settings));
  const packageNames = Object.keys(ref.packages ?? {}).toSorted();
  return {
    clone_mode: resolveSetting('clone_mode', ref, args.settings),
    description: ref.description,
    key,
    ...(refState?.last_fetched_at === undefined
      ? {}
      : { last_fetched_at: refState.last_fetched_at }),
    missing: !isGitCheckout(checkoutPath(args.home, zRefKey.parse(key))),
    ...(args.includePackages ? { packages: packageNames } : {}),
    packages_count: packageNames.length,
    stale: isStale(refState?.last_fetched_at, ttlMs, args.now),
  };
};

const listItems = (args: ListArgs): ListItem[] => {
  const itemArgs: ItemArgs = {
    home: args.home,
    includePackages: args.includePackages,
    now: args.now,
    settings: args.config.settings,
    state: args.state,
  };
  const items = Object.entries(args.config.refs).map(([key, ref]) =>
    buildListItem(itemArgs, key, ref),
  );
  return items.toSorted((left, right) => left.key.localeCompare(right.key));
};

const runList = async (
  ctx: CliContext,
  includePackages: boolean,
  now: number,
): Promise<ListItem[]> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const state = await readState(home);
  return listItems({ config, home, includePackages, now, state });
};

const NO_REFS_LINE = 'no refs configured — run: refs add <source>';

const linesFor = (item: ListItem, now: number): string[] => [
  `ref: ${item.key}`,
  `description: ${item.description}`,
  ...statusLines({
    lastFetchedAt: item.last_fetched_at,
    missing: item.missing,
    now,
    stale: item.stale,
  }),
];

// The blank line between entries is produced here rather than in `emit`: `list` is the only
// command in the key/value format that renders more than one entry (`sync` and `doctor` keep
// their own layouts), so a generic grouping API on `emit` would have exactly one caller.
const listHuman = (items: readonly ListItem[], now: number): string[] => {
  if (items.length === 0) {
    return [NO_REFS_LINE];
  }
  return items.reduce<string[]>((lines, item, index) => {
    if (index > 0) {
      lines.push('');
    }
    lines.push(...linesFor(item, now));
    return lines;
  }, []);
};

// Suffix matching, shared by show/resolve/sync/edit/remove/tag ------------

const keySegments = (key: string): string[] => key.split('/');

const matchesQuery = (key: string, querySegments: readonly string[]): boolean => {
  const segments = keySegments(key);
  if (querySegments.length > segments.length) {
    return false;
  }
  const offset = segments.length - querySegments.length;
  return querySegments.every((segment, index) => segment === segments[offset + index]);
};

/** Resolves `query` (a full ref key, or a unique suffix matched on segment boundaries from the
 * right — e.g. `zod` or `colinhacks/zod` both match `github.com/colinhacks/zod`) against
 * `config.refs`. An exact full-key match wins immediately, even when some other configured key's
 * suffix also happens to equal `query` (e.g. `github.com/colinhacks/zod` vs.
 * `corp-mirror/github.com/colinhacks/zod`) — otherwise a ref would be unresolvable by its own full
 * key. Throws `usageError` (listing every candidate) when more than one key matches, and
 * `notFoundError` when none do. */
const matchRefKey = (config: Config, query: string): RefKey => {
  if (Object.hasOwn(config.refs, query)) {
    return zRefKey.parse(query);
  }
  const querySegments = keySegments(query);
  const matches = Object.keys(config.refs)
    .filter((key) => matchesQuery(key, querySegments))
    .toSorted();
  const [first] = matches;
  if (first === undefined) {
    throw notFoundError(`no ref matches '${query}'`);
  }
  if (matches.length > 1) {
    throw usageError(`'${query}' matches more than one ref: ${matches.join(', ')}`);
  }
  return zRefKey.parse(first);
};

const registerList = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('list')
    .description('List configured refs with their staleness/missing checkout status.')
    .option('--packages', "include each ref's package names in --json output (off by default)")
    .action((localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const now = Date.now();
        const items = await runList(ctx, localOpts.packages === true, now);
        emit(ctx, opts, listHuman(items, now), items);
      })();
    });
};

export { listHuman, matchRefKey, registerList };
export type { ListItem };
