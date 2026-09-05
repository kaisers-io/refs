import type { Config, PackageEntry, RefKey } from '@kaisers-io/refs-core';
import {
  RefsError,
  canonicalizeGitUrl,
  notFoundError,
  usageError,
  validationError,
  zRefKey,
} from '@kaisers-io/refs-core';
import { matchRefKey } from './list.ts';

// Turning one query string into the ref (and, where applicable, the package inside it) it denotes.
// Split out of `resolve.ts`, which was carrying this four-step precedence alongside everything else
// the command does.
//
// The precedence exists because a single argument has to serve four different shapes an agent might
// hold — a git url, an exact package name, an import path, or a ref-key suffix — and get exactly one
// answer. Ambiguity is never resolved by picking: it throws, naming what to pass instead.

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
  /** Full key or unique suffix of the ref to scope package routing to. With it, the query is only
   * ever matched as a package name or import path WITHIN that ref — it never falls through to ref
   * routing, because the caller has already said which ref they mean. */
  ref?: string;
};

// Describes what was searched; does NOT prescribe adding the repository.
//
// It used to end "run refs list, or add it: refs add <url>", and the second half was a guess: a
// query can miss every route while the repository is perfectly well tracked under another
// identifier — a monorepo root whose own package name was never registered, say. An agent read
// that suggestion as confirmation and told a user their tracked repo was untracked.
//
// So the remedy is now evidence rather than instruction: `refs list` shows what IS configured,
// which is true regardless of which scope failed. `refs add` appears only where the query named a
// ref outright and that ref really is absent — the one case where adding is the right advice.
const notFoundMessage = (query: string): string =>
  `no registered package or ref matches '${query}' — this does not establish that the ` +
  `repository is untracked; it may be registered under a different identifier. Run: refs list --json`;

const refNotRegisteredMessage = (key: RefKey): string =>
  `ref '${key}' is not in the active refs configuration — to track it: refs add <url>`;

// `--ref` takes a full key or a unique suffix of one, so a miss says the identifier did not
// resolve — never that the repository is absent. It names the shapes that DO work instead of
// prescribing anything.
const refUnresolvedMessage = (ref: string): string =>
  `--ref '${ref}' matched no configured ref — pass a full ref key or a unique suffix of one. ` +
  `Run: refs list --json`;

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
  // A canonical git url names one ref and nothing else, so this genuinely IS "that ref is not
  // configured" — the only miss in this file where suggesting `refs add` is sound. The key is
  // named rather than the raw query: a url can carry credentials, the canonical key cannot.
  throw notFoundError(refNotRegisteredMessage(canonical.key), 'ref_not_registered');
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

// The remedy has to be one the command actually implements. This used to say "use the full ref
// key", which routes by ref rather than by package and comes back with `package: null` — a caller
// following the advice got a success envelope with no package in it, and was left guessing a
// directory, which is the exact guesswork `resolve` exists to remove.
const ambiguousPackageMessage = (name: string, keys: readonly RefKey[]): string =>
  `package '${name}' is registered by more than one ref: ${keys.join(', ')} — pick one with: ` +
  `refs resolve ${name} --ref <ref>`;

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

/** Decreasing-length segment prefixes of `query`, longest first, excluding the full string (which
 * the caller has already tried as an exact match). Yielding longest-first is what makes the FIRST
 * hit necessarily the longest one, so `react/jsx-runtime` resolves to `react` and
 * `@scope/pkg/sub/path` to `@scope/pkg` without hard-coding scoped-vs-unscoped segment counts.
 *
 * One definition, used by both the unscoped search and the `--ref`-scoped one, so the two cannot
 * disagree about what an import path means. */
const segmentPrefixes = function* segmentPrefixes(query: string): Generator<string> {
  const segments = query.split('/');
  for (let length = segments.length - 1; length >= 1; length -= 1) {
    yield segments.slice(0, length).join('/');
  }
};

// Step 3: import-path longest-prefix on segment boundaries, across every ref.
const findPackageByPrefix = (config: Config, query: string): PackageMatch | undefined => {
  for (const candidate of segmentPrefixes(query)) {
    const found = findPackageByName(config, candidate);
    if (found !== undefined) {
      return { ...found, name: candidate };
    }
  }
  return undefined;
};

// Suffix match via `list.ts`'s `matchRefKey`. Its ambiguity `usageError` (more than one candidate)
// passes through unchanged, but its plain not_found ("no ref matches '<query>'", no call-to-action)
// is replaced with a message the caller supplies, because the same lookup fails for two different
// reasons — unscoped step 4, and resolving an explicit `--ref`.
//
// The REASON is `unmatched_query` either way, and deliberately not the stronger
// `ref_not_registered`. `matchRefKey` compares full keys and key suffixes; a miss means the
// identifier resolved to nothing, NOT that the ref is absent. With
// `github.com/vercel/next.js` configured, `--ref next` misses and `--ref next.js` succeeds — the
// same repository, one identifier that happens not to be a suffix. Calling that "not registered"
// and suggesting `refs add` would recreate, one flag over, exactly the false conclusion this
// module was changed to stop. Only a canonical git url establishes an exact identity, and only
// `tryUrlRoute` uses the stronger reason.
const matchSuffixOrThrow = (config: Config, query: string, message: string): RefKey => {
  try {
    return matchRefKey(config, query);
  } catch (error) {
    if (error instanceof RefsError && error.code === 'not_found') {
      throw notFoundError(message, 'unmatched_query');
    }
    throw error;
  }
};

/** `--ref` routing: the query is matched as a package name, then as an import-path prefix, against
 * the named ref alone.
 *
 * It deliberately does NOT fall through to ref routing. The caller has already named the ref, so a
 * query that matches no package in it is a mistake worth reporting rather than a reason to hand
 * back the ref itself with no package — which is precisely the silent near-miss this flag was added
 * to fix. */
const packageWithin = (
  packages: Readonly<Record<string, PackageEntry>>,
  query: string,
): { entry: PackageEntry; name: string } | undefined => {
  const exact = packages[query];
  if (exact !== undefined) {
    return { entry: exact, name: query };
  }
  for (const candidate of segmentPrefixes(query)) {
    const found = packages[candidate];
    if (found !== undefined) {
      return { entry: found, name: candidate };
    }
  }
  return undefined;
};

const routeWithinRef = (config: Config, query: string, ref: string): RouteMatch => {
  const key = matchSuffixOrThrow(config, ref, refUnresolvedMessage(ref));
  const found = packageWithin(config.refs[key]?.packages ?? {}, query);
  if (found === undefined) {
    // A url-shaped query is never echoed: it can carry credentials, which is the same reason the
    // unscoped path raises a message that does not mention the query at all.
    // `--packages`, not a bare `show`: without it the output carries a package COUNT and no
    // names, so a reader following this advice still cannot see what the ref does register.
    throw notFoundError(
      looksLikeGitUrl(query)
        ? `ref '${key}' is tracked but registers no package matching that query — inspect: refs show ${key} --packages --json`
        : `ref '${key}' is tracked but registers no package matching '${query}' — inspect: refs show ${key} --packages --json`,
      'package_not_registered',
    );
  }
  return { key, packageMatch: { ...found, key } };
};

const routeUnscoped = (config: Config, query: string, options: RouteOptions): RouteMatch => {
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
  return { key: matchSuffixOrThrow(config, query, notFoundMessage(query)) };
};

/** The one entry point: `--ref` switches to package-only routing within that ref, everything else
 * goes through the four-step precedence. */
const routeQuery = (config: Config, query: string, options: RouteOptions): RouteMatch =>
  options.ref === undefined
    ? routeUnscoped(config, query, options)
    : routeWithinRef(config, query, options.ref);

export { routeQuery };
export type { PackageMatch, RouteMatch, RouteOptions };
