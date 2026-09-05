import type { Config, RefKey, RefsHome, State } from '@kaisers-io/refs-core';
import {
  EXIT,
  checkoutPath,
  durationToMs,
  isBehind,
  isGitCheckout,
  loadLatestVersion,
  readConfig,
  readState,
  resolveHome,
  resolveSetting,
  shouldNotify,
  updateMessage,
  zRefKey,
} from '@kaisers-io/refs-core';
import type { SyncItemStatus, SyncResultItem } from './sync-core.ts';
import { cliOptsOf, emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefSyncContext } from './sync-checkout.ts';
import type { RefsCommand } from './registry.ts';
import { driftLines } from './drift-report.ts';
import { isStale } from './ref-status.ts';
import { matchRefKey } from './list.ts';
import { requireEntry } from './ref-context.ts';
import { syncAll } from './sync-core.ts';

// `refs sync [refs…] [--stale-only]` — fetches (or, if the checkout is missing, re-clones) every
// requested ref, defaulting to all configured refs. This file owns target resolution, staleness
// filtering, and human-mode summary formatting; the per-ref clone/sync/lock pipeline is in
// `sync-core.ts`.

const buildContext = (home: RefsHome, config: Config, key: RefKey): RefSyncContext => ({
  home,
  key,
  ref: requireEntry(config, key),
  settings: config.settings,
});

/** No `refs` argument → every configured ref, sorted for deterministic output (mirrors `list.ts`);
 * otherwise each argument is resolved via `matchRefKey` (full key or unique suffix) — an unmatched
 * or ambiguous query throws immediately (fail fast), before any ref in the batch is touched. */
const resolveTargets = (
  home: RefsHome,
  config: Config,
  requested: readonly string[],
): RefSyncContext[] => {
  if (requested.length === 0) {
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

type SyncOptions = {
  refs: string[];
  staleOnly: boolean;
};

type SyncOutcome = {
  failedCount: number;
  results: SyncResultItem[];
  warnings: string[];
};

/** One update check per `refs sync` invocation, deliberately outside the per-ref pipeline: that
 * pipeline fans out four refs at a time (`syncAll`) and turns any throw into a per-ref failure
 * recorded in state (`syncOneKey`). A question about this CLI's own version belongs to neither.
 *
 * Only the invocation that actually refreshed the cache announces anything, which is what limits
 * the notice to once a day without recording that a notice was shown. Failure is silent: `sync`
 * reports on refs, and a registry it could not reach is not a fact about them. */
const updateWarnings = async (
  ctx: CliContext,
  home: RefsHome,
  config: Config,
): Promise<string[]> => {
  if (!shouldNotify({ env: ctx.env, updates: config.updates })) {
    return [];
  }
  const { latest, refreshed } = await loadLatestVersion({
    fetch: ctx.fetcher,
    home,
    nowMs: Date.now(),
  });
  if (!refreshed || latest === undefined || !isBehind(ctx.cliVersion, latest)) {
    return [];
  }
  return [updateMessage(ctx.cliVersion, latest)];
};

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
  // Concurrent with the refs themselves — a sync that had nothing to do (everything inside its
  // `sync_ttl`) stays the no-op it is, and never touches the network on its own account.
  const [results, warnings] = await Promise.all([
    syncAll(ctx, scoped),
    scoped.length > 0 ? updateWarnings(ctx, home, config) : Promise.resolve([]),
  ]);
  const failedCount = results.filter((item) => item.status === 'failed').length;
  return { failedCount, results, warnings };
};

const STATUS_ORDER: readonly SyncItemStatus[] = [
  'updated',
  'fresh',
  'cloned',
  'restored',
  'failed',
];

const STATUS_LABEL: Record<SyncItemStatus, string> = {
  cloned: 'Cloned',
  failed: 'Failed',
  fresh: 'Fresh',
  restored: 'Restored',
  updated: 'Updated',
};

const SUMMARY_SEP = ' / ';

const groupByStatus = (
  results: readonly SyncResultItem[],
): Record<SyncItemStatus, SyncResultItem[]> => {
  const groups: Record<SyncItemStatus, SyncResultItem[]> = {
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

const DRIFT_INDENT = '    ';

/** The ref's own line, then one further-indented line per drift finding. Drift deliberately does
 * NOT go into the parenthesised warning: that already merges the branch-rename notice with the
 * clone warning, and a third meaning would make one dense parenthesis carry three unrelated
 * facts. A clean ref produces exactly the single line it always did. */
const linesFor = (item: SyncResultItem): string[] => {
  if (item.status === 'failed') {
    return [`  ${item.key}: ${item.error ?? 'unknown error'}`];
  }
  const head = item.warning === undefined ? `  ${item.key}` : `  ${item.key} (${item.warning})`;
  if (item.structure === undefined) {
    return [head];
  }
  return [head, ...driftLines(item.structure).map((line) => `${DRIFT_INDENT}${line}`)];
};

/** `Updated (N) / Fresh (N) / Cloned (N) / Restored (N) / Failed (N)` summary line, followed by
 * every non-empty group's keys (with the failure message for `Failed`, or the warning in
 * parentheses when one fired, and any drift found under the ref it belongs to) — printed even
 * when every count is 0 (e.g. `--stale-only` filtered the whole batch away), rather than
 * special-casing an empty result set. The counts themselves are untouched by drift: a drifted ref
 * synced fine, and moving it out of `Updated` would misreport what happened. */
const syncHuman = (results: readonly SyncResultItem[]): string[] => {
  const groups = groupByStatus(results);
  const summary = STATUS_ORDER.map(
    (status) => `${STATUS_LABEL[status]} (${groups[status].length})`,
  ).join(SUMMARY_SEP);
  const lines = [summary];
  for (const status of STATUS_ORDER) {
    for (const item of groups[status]) {
      lines.push(...linesFor(item));
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
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        // `runSync` is this command's pure async body (mirrors runInit/runAdd/runList/runShow) —
        // the rule fires on the `Sync` name suffix alone, not on any synchronous fs call.
        // eslint-disable-next-line node/no-sync -- runSync is an async command body; the rule matches the name suffix only
        const outcome = await runSync(ctx, buildSyncOptions(refs, localOpts));
        emit(ctx, opts, syncHuman(outcome.results), { results: outcome.results }, outcome.warnings);
        // `wrapAction` only sets `process.exitCode` on a THROWN error; a batch with per-ref
        // failures is not one (the envelope itself is still `ok: true`), so this is the one place
        // that needs to set it directly — exactly once, and only in the failure case.
        if (outcome.failedCount > 0) {
          process.exitCode = EXIT.UNEXPECTED;
        }
      })();
    });
};

export { registerSync, syncHuman };
