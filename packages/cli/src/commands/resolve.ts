import type { Config, PackageEntry, RefKey, State } from '@kaisers-io/refs-core';
import {
  RefsError,
  canonicalizeGitUrl,
  checkoutPath,
  durationToMs,
  isGitCheckout,
  notFoundError,
  readConfig,
  readState,
  resolveHome,
  resolveSetting,
  usageError,
  validationError,
  zRefKey,
} from '@kaisers-io/refs-core';
import { cliOptsOf, emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { allowFileUrlsFrom } from './add-source.ts';
import { isStale } from './ref-status.ts';
import { join } from 'node:path';
import { matchRefKey } from './list.ts';
import { requireEntry } from './ref-context.ts';

// `refs resolve <query>` — the agent-routing command. Turns a git url, an exact npm package name,
// an import path (e.g. `@scope/pkg/sub/path`), or a unique ref-key suffix into the one configured ref (and,
// where applicable, the one package within it) the query denotes, via a deterministic
// four-step precedence (see `routeQuery` below). No match at all → `notFoundError` with the fixed
// "no ref matches" message every step below ultimately funnels into.

type ResolvePackage = {
  local_path: string;
  name: string;
  path: string;
};

type ResolveData = {
  key: string;
  local_path: string;
  missing: boolean;
  package: ResolvePackage | null;
  stale: boolean;
};

type PackageMatch = {
  entry: PackageEntry;
  key: RefKey;
  name: string;
};

type RouteMatch = {
  key: RefKey;
  packageMatch?: PackageMatch;
};

type RouteOptions = {
  allowFileUrls: boolean;
};

const notFoundMessage = (query: string): string =>
  `no ref matches '${query}' — run refs list, or add it: refs add <url>`;

// A query that plainly LOOKS like a git url — either a `scheme://...` form (scheme anchored at
// the very start of the string, so an unrelated import path that merely CONTAINS "://" further in,
// e.g. `@scope/pkg/https://weird`, is never misclassified and instead falls through to step 3's
// prefix routing), or the scp-style `git@host:path` form `canonicalizeGitUrl` itself recognizes
// (its `SCP_URL` regex isn't exported, so this mirrors that one shape only, deliberately not the
// general "any string with an @ and a colon" case). Used solely to decide whether a canonicalization
// failure is decisive (hard-fail) or merely "not a url at all, fall through to steps 2-4" — a false
// negative here just falls through as before, so it's fine to keep this conservative/simple rather
// than exhaustive.
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
const SCP_URL_SHAPE = /^git@[^:/\s]+:[^\s]+$/u;

const looksLikeGitUrl = (query: string): boolean =>
  URL_SCHEME_PATTERN.test(query) || SCP_URL_SHAPE.test(query);

const notCanonicalizableMessage =
  'query looks like a git url but is not a supported form — check the url (credentials are ' +
  'never accepted) or run: refs resolve <package|ref-suffix>';

// Step 1: does `query` parse as a git url at all? A throw here means "not a git url" (any reason —
// unsupported scheme, an unrelated bare word) and simply falls through to step 2; only a URL that
// DOES canonicalize but names an unconfigured ref is treated as decisive (immediate not_found, no
// fall-through) — an agent that passed a real git url almost certainly meant that exact ref, not
// some unrelated package/suffix match. EXCEPTION: when `query` plainly looks like a url (see
// `looksLikeGitUrl`) and canonicalization still throws (e.g. embedded credentials, a malformed
// path), that failure is decisive too — BUT the core canonicalizer's own error is never rethrown as
// is: several of its messages interpolate the raw input verbatim (e.g. `not a supported git url:
// ${input}`), so rethrowing it — or falling through and letting `notFoundMessage` interpolate the
// query instead — would both echo any embedded secret straight into the output/logs. Instead, a
// brand-new, generic `validationError` is thrown here that never mentions the raw query at all.
const canonicalizeOrUndefined = (
  query: string,
  options: RouteOptions,
): { key: RefKey } | undefined => {
  try {
    return canonicalizeGitUrl(query, options);
  } catch {
    if (looksLikeGitUrl(query)) {
      throw validationError(notCanonicalizableMessage);
    }
    return undefined;
  }
};

const tryUrlRoute = (
  config: Config,
  query: string,
  options: RouteOptions,
): RouteMatch | undefined => {
  const canonical = canonicalizeOrUndefined(query, options);
  if (canonical === undefined) {
    return undefined;
  }
  if (Object.hasOwn(config.refs, canonical.key)) {
    return { key: canonical.key };
  }
  throw notFoundError(notFoundMessage(query));
};

type PackageEntryMatch = {
  entry: PackageEntry;
  key: RefKey;
};

// Every ref (sorted by key, for determinism) whose `packages` map registers exactly `name` —
// shared by step 2 (exact query match) and step 3 (segment-prefix match, via `findPackageByPrefix`
// below), so a name registered by more than one ref is caught identically from either entry point.
const packageMatchesFor = (config: Config, name: string): PackageEntryMatch[] => {
  const matches: PackageEntryMatch[] = [];
  for (const key of Object.keys(config.refs).toSorted()) {
    const entry = config.refs[key]?.packages?.[name];
    if (entry !== undefined) {
      matches.push({ entry, key: zRefKey.parse(key) });
    }
  }
  return matches;
};

const ambiguousPackageMessage = (name: string, keys: readonly RefKey[]): string =>
  `package '${name}' is registered by more than one ref: ${keys.join(', ')} — use the full ref key`;

// Step 2/3 shared lookup: the sole ref registering `name`. Resolve's whole purpose is unambiguous
// agent routing, so more than one candidate is a routing ambiguity — this throws `usageError`
// (listing every colliding ref key), mirroring step 4's `matchRefKey` ambiguity handling, rather
// than silently picking the lexicographically-first ref the way a plain lookup would.
const findPackageByName = (
  config: Config,
  name: string,
): { entry: PackageEntry; key: RefKey } | undefined => {
  const matches = packageMatchesFor(config, name);
  const [first] = matches;
  if (first === undefined) {
    return undefined;
  }
  if (matches.length > 1) {
    throw usageError(
      ambiguousPackageMessage(
        name,
        matches.map((match) => match.key),
      ),
    );
  }
  return first;
};

// Step 3: import-path longest-prefix on segment boundaries. Tries decreasing-length segment
// prefixes of `query` (excluding the full string, already tried by step 2) against every ref's
// package names, so the FIRST hit found is necessarily the longest matching one — this naturally
// resolves `react/jsx-runtime` to `react` (a 1-segment prefix) and `@scope/pkg/sub/path` to
// `@scope/pkg` (a 2-segment prefix) without hard-coding scoped-vs-unscoped segment counts.
const findPackageByPrefix = (config: Config, query: string): PackageMatch | undefined => {
  const segments = query.split('/');
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    const candidate = segments.slice(0, length).join('/');
    const found = findPackageByName(config, candidate);
    if (found !== undefined) {
      return { ...found, name: candidate };
    }
  }
  return undefined;
};

// Step 4: suffix match via `list.ts`'s `matchRefKey`. Its ambiguity `usageError` (more than one
// candidate) passes through unchanged, but its plain not_found ("no ref matches '<query>'", no
// call-to-action) is replaced with resolve's own — the message every no-match path here ends on.
const matchSuffixOrThrow = (config: Config, query: string): RefKey => {
  try {
    return matchRefKey(config, query);
  } catch (error) {
    if (error instanceof RefsError && error.code === 'not_found') {
      throw notFoundError(notFoundMessage(query));
    }
    throw error;
  }
};

const routeQuery = (config: Config, query: string, options: RouteOptions): RouteMatch => {
  const urlMatch = tryUrlRoute(config, query, options);
  if (urlMatch !== undefined) {
    return urlMatch;
  }
  const exact = findPackageByName(config, query);
  if (exact !== undefined) {
    return { key: exact.key, packageMatch: { ...exact, name: query } };
  }
  const prefixed = findPackageByPrefix(config, query);
  if (prefixed !== undefined) {
    return { key: prefixed.key, packageMatch: prefixed };
  }
  return { key: matchSuffixOrThrow(config, query) };
};

const packageDataFor = (match: RouteMatch, dest: string): ResolvePackage | null => {
  if (match.packageMatch === undefined) {
    // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null, not undefined
    return null;
  }
  const { entry, name } = match.packageMatch;
  return { local_path: join(dest, entry.path), name, path: entry.path };
};

const runResolve = async (ctx: CliContext, query: string): Promise<ResolveData> => {
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  const match = routeQuery(config, query, { allowFileUrls: allowFileUrlsFrom(ctx.env) });
  const entry = requireEntry(config, match.key);
  const state: State = await readState(home);
  const dest = checkoutPath(home, match.key);
  const ttlMs = durationToMs(resolveSetting('sync_ttl', entry, config.settings));
  return {
    key: match.key,
    local_path: dest,
    missing: !isGitCheckout(dest),
    package: packageDataFor(match, dest),
    stale: isStale(state.refs[match.key]?.last_fetched_at, ttlMs, Date.now()),
  };
};

// Labeled-field convention mirroring show.ts's showHuman ('local_path: ...').
const resolveHuman = (data: ResolveData): string[] => {
  const lines = [data.key, `local_path: ${data.local_path}`];
  if (data.package !== null) {
    lines.push(`package: ${data.package.name}`, `local_path: ${data.package.local_path}`);
  }
  return lines;
};

const registerResolve = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('resolve')
    .description(
      'Resolve a git url, npm package name, import path, or ref-key suffix to its ref/package.',
    )
    .argument('<query>', 'git url, npm package name, import path, or unique ref-key suffix')
    .action((query, _localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const data = await runResolve(ctx, query);
        emit(ctx, opts, resolveHuman(data), data);
      })();
    });
};

export { registerResolve, runResolve };
export type { ResolveData };
