import type { Config, RefsHome, State } from '@kaisers-io/refs-core';
import { assertProjectDir, resolveInstalled } from './resolve-installed.ts';
import {
  checkoutPath,
  durationToMs,
  readConfig,
  readState,
  resolveHome,
  resolveSetting,
  usageError,
  validationError,
} from '@kaisers-io/refs-core';
import type { CheckoutInfo } from './resolve-checkout.ts';
import type { CliContext } from '../context.ts';
import type { InstalledInfo } from './resolve-installed.ts';
import type { ResolvePackage } from './resolve-package.ts';
import type { RouteMatch } from './resolve-route.ts';
import { allowFileUrlsFrom } from './add-source.ts';
import { inspectCheckout } from './resolve-checkout.ts';
import { isStale } from './ref-status.ts';
import { packageDataFor } from './resolve-package.ts';
import { requireEntry } from './ref-context.ts';
import { routeQuery } from './resolve-route.ts';
import { syncOneOrThrow } from './sync-core.ts';
// What `refs resolve` actually does, in order. Split from `resolve.ts`, which is now the command
// itself — its flags, and how the result renders for a human.
//
// The ordering here is the substance. Validation that can reject the invocation runs before
// anything touches the filesystem; the checkout's identity is established before its contents are
// trusted; and every answer about the package is gated on that identity, because a manifest read
// inside an unrelated checkout can report `verified` about the wrong repository entirely.

type ResolveData = {
  /** What is actually at `local_path` — see `resolve-checkout.ts`. Branch on this, not on
   * `missing`: only `managed` means the path is the checkout this ref names. */
  checkout: CheckoutInfo;
  key: string;
  last_fetched_at?: string;
  local_path: string;
  /** Kept as `checkout.status === 'missing'` for callers that predate `checkout`. It answers a
   * narrower question than they may think it does — a path can be present and still not be this
   * ref's checkout — which is why `checkout` exists alongside it rather than replacing it. */
  missing: boolean;
  /** Present only with `--project`: what that project has installed of the routed package. */
  installed?: InstalledInfo;
  package: ResolvePackage | null;
  stale: boolean;
  /** Present only with `--sync-if-stale`, and only when a sync actually ran. */
  sync?: { status: string };
};

type ResolveOptions = {
  now: number;
  /** Directory to resolve the installed version from — the importing workspace package, not
   * necessarily the repo root, since that is where Node's lookup would start. */
  project?: string;
  query: string;
  /** Fetch (or clone) before answering, when the ref is stale or its checkout absent. */
  syncIfStale?: boolean;
  /** Full key or unique suffix of the ref to scope package routing to — the remedy the ambiguity
   * error names when one package name is registered by several refs. */
  ref?: string;
};

/** The `package` half of the payload, or `null` when the query denoted the ref itself rather than
 * a package inside it. Verification is gated on the checkout being the one this ref names: a
 * manifest read inside an unrelated checkout can answer `verified` for a package that has nothing
 * to do with the query. */
const packageFor = async (opts: {
  checkout: CheckoutInfo;
  dest: string;
  home: RefsHome;
  match: RouteMatch;
}): Promise<ResolvePackage | null> => {
  const { packageMatch } = opts.match;
  if (packageMatch === undefined) {
    // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null
    return null;
  }
  return await packageDataFor({
    checkoutDir: opts.dest,
    // `missing` is deliberately allowed through: there is nothing to be misled BY, and
    // verification reports it as `unmaterialized`, which is the more useful answer and the one
    // callers already handle. What must not proceed is a checkout that is present but is not this
    // ref's — there a manifest read can answer `verified` about the wrong repository entirely.
    checkoutManaged: opts.checkout.status === 'managed' || opts.checkout.status === 'missing',
    checkoutReason: `checkout is ${opts.checkout.status}`,
    configuredPath: packageMatch.entry.path,
    home: opts.home,
    key: opts.match.key,
    packageName: packageMatch.name,
  });
};

const routeFor = (ctx: CliContext, config: Config, opts: ResolveOptions): RouteMatch =>
  routeQuery(config, opts.query, {
    allowFileUrls: allowFileUrlsFrom(ctx.env),
    ...(opts.ref === undefined ? {} : { ref: opts.ref }),
  });

/** Everything read from disk before anything is decided: the config, the routed match, and the
 * ref's recorded state. Split from `runResolve` so that function reads as the sequence of
 * decisions it is rather than as the reads those decisions need. */
const loadTarget = async (
  ctx: CliContext,
  opts: ResolveOptions,
): Promise<{ config: Config; home: RefsHome; match: RouteMatch; state: State }> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  return { config, home, match: routeFor(ctx, config, opts), state: await readState(home) };
};

/** What `--project` reports, or `undefined` when it was not asked for.
 *
 * A query that denotes a REF rather than a package is a usage error rather than an empty answer:
 * there is no single package to look up, and inferring one — even when the ref happens to register
 * exactly one — would make the command's meaning depend on configuration the caller cannot see. */
const installedFor = async (
  match: RouteMatch,
  project: string | undefined,
): Promise<InstalledInfo | undefined> => {
  if (project === undefined) {
    return undefined;
  }
  const { packageMatch } = match;
  if (packageMatch === undefined) {
    throw usageError(
      `--project needs a query that names a package; '${match.key}' resolves to the ref itself`,
    );
  }
  return await resolveInstalled(project, packageMatch.name);
};

/** Refuses to sync a checkout that syncing cannot repair.
 *
 * A `missing` one is exactly what the clone path is for. But `unmanaged` and `unverifiable` mean
 * something is at that path which is not this ref's checkout, or cannot be read — and `sync` is
 * destructive: it hard-resets and cleans. Handing it a directory whose identity was never
 * established is how a stray clone gets its history wiped. Refusing is the only safe answer, and it
 * is a `validation` failure rather than a silent skip, because the caller asked for freshness. */
const assertSyncable = (checkout: CheckoutInfo, key: string): void => {
  if (checkout.status === 'managed' || checkout.status === 'missing') {
    return;
  }
  throw validationError(
    `refusing to sync ${key}: its checkout is ${checkout.status}` +
      `${checkout.reason === undefined ? '' : ` (${checkout.reason})`} — run: refs doctor`,
  );
};

/** Syncs the one ref, throwing its real error rather than flattening it into a per-item string the
 * way the batch does. A caller that asked for freshness and did not get it is being handed a stale
 * path, so this fails the command instead of reporting success with a `sync` field nobody reads. */
const syncTarget = async (
  ctx: CliContext,
  target: { config: Config; home: RefsHome; match: RouteMatch },
): Promise<string> => {
  const outcome = await syncOneOrThrow(ctx, {
    home: target.home,
    key: target.match.key,
    ref: requireEntry(target.config, target.match.key),
    settings: target.config.settings,
  });
  return outcome.status;
};

const runResolve = async (ctx: CliContext, opts: ResolveOptions): Promise<ResolveData> => {
  // Before anything reads or writes: an invalid `--project` is a mistake in the invocation, and
  // must not be discovered only after a `--sync-if-stale` in the same call has mutated a checkout.
  if (opts.project !== undefined) {
    await assertProjectDir(opts.project);
  }
  const target = await loadTarget(ctx, opts);
  const first = await describeTarget(ctx, target, opts);
  if (opts.syncIfStale !== true || !(first.stale || first.missing)) {
    return first;
  }
  assertSyncable(first.checkout, first.key);
  const status = await syncTarget(ctx, target);
  // Everything is re-read and re-derived afterwards, not patched: the sync may have created the
  // checkout, moved packages within it, or advanced state. Reusing any part of the pre-sync
  // snapshot is precisely the mistake the mandatory second `resolve` call existed to avoid — the
  // one this flag exists to make unnecessary.
  const after = await describeTarget(ctx, await loadTarget(ctx, opts), opts);
  return { ...after, sync: { status } };
};

/** Assembles the payload from an already-loaded target. Kept apart from `runResolve` so that
 * function reads as the preflight-then-describe sequence it is. */
const describeTarget = async (
  ctx: CliContext,
  target: { config: Config; home: RefsHome; match: RouteMatch; state: State },
  opts: ResolveOptions,
): Promise<ResolveData> => {
  const { config, home, match, state } = target;
  const { now } = opts;
  const entry = requireEntry(config, match.key);
  const dest = checkoutPath(home, match.key);
  const ttlMs = durationToMs(resolveSetting('sync_ttl', entry, config.settings));
  const lastFetchedAt = state.refs[match.key]?.last_fetched_at;
  const checkout = await inspectCheckout({
    allowFileUrls: allowFileUrlsFrom(ctx.env),
    dest,
    expectedUrl: entry.url,
    sourcesDir: home.sourcesDir,
  });
  const installed = await installedFor(match, opts.project);
  return {
    checkout,
    key: match.key,
    ...(lastFetchedAt === undefined ? {} : { last_fetched_at: lastFetchedAt }),
    ...(installed === undefined ? {} : { installed }),
    local_path: dest,
    missing: checkout.status === 'missing',
    package: await packageFor({ checkout, dest, home, match }),
    stale: isStale(lastFetchedAt, ttlMs, now),
  };
};

export { runResolve };
export type { ResolveData, ResolveOptions };
