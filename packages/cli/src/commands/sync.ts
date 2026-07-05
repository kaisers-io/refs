import type { Config, RefEntry, RefKey, RefsHome, State } from '@kaisers-io/refs-core';
import {
  EXIT,
  checkoutPath,
  durationToMs,
  isGitCheckout,
  readConfig,
  readState,
  resolveHome,
  resolveSetting,
  zRefKey,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import type { RefSyncContext, SyncStatus } from './sync-checkout.ts';
import { emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import type { SyncResultItem } from './sync-core.ts';
import { isStale } from './ref-status.ts';
import { matchRefKey } from './list.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { syncAll } from './sync-core.ts';

// `refs sync [refs…] [--stale-only]` — fetches (or, if the checkout is missing, re-clones) every
// requested ref, defaulting to all configured refs. Target resolution/staleness-filtering and
// human-mode summary formatting live here; the actual per-ref clone/sync/lock pipeline is in
// `sync-core.ts`, split out purely to keep this file under the repo's 300-line oxlint cap.

const requireEntry = (config: Config, key: RefKey): RefEntry => {
  const entry = config.refs[key];
  if (entry === undefined) {
    throw new Error(`internal: matched ref key '${key}' is missing from config.refs`);
  }
  return entry;
};

const buildContext = (home: RefsHome, config: Config, key: RefKey): RefSyncContext => ({
  home,
  key,
  ref: requireEntry(config, key),
  settings: config.settings,
});

const NO_REQUESTED = 0;

/** No `refs` argument → every configured ref, sorted for deterministic output (mirrors `list.ts`);
 * otherwise each argument is resolved via `matchRefKey` (full key or unique suffix) — an unmatched
 * or ambiguous query throws immediately (fail fast), before any ref in the batch is touched. */
const resolveTargets = (
  home: RefsHome,
  config: Config,
  requested: readonly string[],
): RefSyncContext[] => {
  if (requested.length === NO_REQUESTED) {
    return Object.keys(config.refs)
      .toSorted()
      .map((key) => buildContext(home, config, zRefKey.parse(key)));
  }
  return requested.map((query) => buildContext(home, config, matchRefKey(config, query)));
};

/** `--stale-only` means "skip refs that need no work" — NOT merely "skip refs within their TTL".
 * A ref whose checkout directory has been deleted needs a re-clone regardless of how recently it
 * was last fetched, so a target is kept when it is EITHER stale-by-TTL (`ref-status.ts#isStale`,
 * the exact same rule `list.ts` uses for its `[stale]` marker, so the two commands never disagree
 * on what "stale" means) OR its checkout is missing (`isGitCheckout` false) — checked BEFORE any
 * sync runs. */
const filterStale = (
  home: RefsHome,
  targets: readonly RefSyncContext[],
  state: State,
): RefSyncContext[] => {
  const now = Date.now();
  return targets.filter((rsc) => {
    const ttlMs = durationToMs(resolveSetting('sync_ttl', rsc.ref, rsc.settings));
    const staleByTtl = isStale(state.refs[rsc.key]?.last_fetched_at, ttlMs, now);
    const checkoutMissing = !isGitCheckout(checkoutPath(home, rsc.key));
    return staleByTtl || checkoutMissing;
  });
};

interface SyncOptions {
  refs: string[];
  staleOnly: boolean;
}

interface SyncOutcome {
  failedCount: number;
  results: SyncResultItem[];
}

/** Applies `--stale-only`'s filter, reading state only when it's actually needed. */
const scopeTargets = async (
  home: RefsHome,
  targets: RefSyncContext[],
  staleOnly: boolean,
): Promise<RefSyncContext[]> => {
  if (!staleOnly) {
    return targets;
  }
  const state = await readState(home);
  return filterStale(home, targets, state);
};

const runSync = async (ctx: CliContext, opts: SyncOptions): Promise<SyncOutcome> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const targets = resolveTargets(home, config, opts.refs);
  const scoped = await scopeTargets(home, targets, opts.staleOnly);
  const results = await syncAll(ctx, scoped);
  const failedCount = results.filter((item) => item.status === 'failed').length;
  return { failedCount, results };
};

const STATUS_ORDER: readonly (SyncStatus | 'failed')[] = [
  'updated',
  'fresh',
  'cloned',
  'restored',
  'failed',
];

const STATUS_LABEL: Record<SyncStatus | 'failed', string> = {
  cloned: 'Cloned',
  failed: 'Failed',
  fresh: 'Fresh',
  restored: 'Restored',
  updated: 'Updated',
};

const SUMMARY_SEP = ' / ';

const groupByStatus = (
  results: readonly SyncResultItem[],
): Record<SyncStatus | 'failed', SyncResultItem[]> => {
  const groups: Record<SyncStatus | 'failed', SyncResultItem[]> = {
    cloned: [],
    failed: [],
    fresh: [],
    restored: [],
    updated: [],
  };
  for (const item of results) {
    groups[item.status].push(item);
  }
  return groups;
};

const lineFor = (item: SyncResultItem): string => {
  if (item.status === 'failed') {
    return `  ${item.key}: ${item.error ?? 'unknown error'}`;
  }
  if (item.warning !== undefined) {
    return `  ${item.key} (${item.warning})`;
  }
  return `  ${item.key}`;
};

/** `Updated (N) / Fresh (N) / Cloned (N) / Restored (N) / Failed (N)` summary line, followed by
 * every non-empty group's keys (with the failure message for `Failed`, or the warning in
 * parentheses when one fired) — printed even when every count is 0 (e.g. `--stale-only` filtered
 * the whole batch away), rather than special-casing an empty result set. */
const syncHuman = (results: readonly SyncResultItem[]): string[] => {
  const groups = groupByStatus(results);
  const summary = STATUS_ORDER.map(
    (status) => `${STATUS_LABEL[status]} (${groups[status].length})`,
  ).join(SUMMARY_SEP);
  const lines = [summary];
  for (const status of STATUS_ORDER) {
    for (const item of groups[status]) {
      lines.push(lineFor(item));
    }
  }
  return lines;
};

const buildSyncOptions = (refs: string[], localOpts: { staleOnly?: boolean }): SyncOptions => ({
  refs,
  staleOnly: localOpts.staleOnly === true,
});

const registerSync = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('sync')
    .description(
      'Fetch (or re-clone, if the checkout is missing) configured refs — all by default.',
    )
    .argument('[refs...]', 'ref keys or unique suffixes to sync (default: every configured ref)')
    .option('--stale-only', "skip refs whose last sync is still within their ref's sync_ttl")
    .action((refs, localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        // `runSync` is this command's pure async body (mirrors runInit/runAdd/runList/runShow),
        // not a synchronous fs call — the no-sync rule below only matches on the name suffix.
        // eslint-disable-next-line node/no-sync -- see comment above
        const outcome = await runSync(ctx, buildSyncOptions(refs, localOpts));
        emit(ctx, opts, syncHuman(outcome.results), { results: outcome.results });
        // `wrapAction` only sets `process.exitCode` on a THROWN error; a batch with per-ref
        // failures is not one (the envelope itself is still `ok: true`), so this is the one place
        // that needs to set it directly — exactly once, and only in the failure case.
        if (outcome.failedCount > NO_REQUESTED) {
          process.exitCode = EXIT.UNEXPECTED;
        }
      })();
    });
};

export { registerSync, runSync };
export type { SyncOptions, SyncOutcome };
