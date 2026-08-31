import type { Config, RefKey, RefsHome, Settings } from '@kaisers-io/refs-core';
import {
  MAX_LOCK_NAME_BYTES,
  applyGitTransport,
  canonicalizeGitUrl,
  conflictError,
  isEnoent,
  resolveNpmPackage,
  resolveSetting,
  usageError,
} from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { progress } from '../output.ts';
import { readdir } from 'node:fs/promises';

// Source resolution + pre-clone guards for `refs add`: turning `<source>` into a clone url + ref
// key, the configured-transport rewrite, and the conflict/case-collision checks that run BEFORE
// anything is cloned. Guards that run against an already-existing checkout directory (origin
// verification, the managed-checkout marker, `resolveCheckoutHead`) live in
// `add-checkout-guards.ts`; package/proposal shaping in `add-packages.ts`; proposal-file/stdin
// loading in `add-proposal-io.ts`. `refLockName`/`allowFileUrlsFrom` are shared beyond `refs add`
// with the sync pipeline (`sync-checkout.ts`) and other commands (`remove.ts`, `resolve.ts`,
// `edit-ref.ts`).

const NPM_PREFIX = 'npm:';
// `.` as the prefix separator, not `:` — lock names become directory names under `locksDir`, and
// `:` is not a legal character in Windows file names (mkdir fails with EINVAL there).
const REF_LOCK_PREFIX = 'ref.';
const ALLOW_FILE_URLS_FLAG = '1';

// Escaped-form prefix. `HOST_SEGMENT` makes a ref key start with `[a-z0-9]`, so a plain name can
// never begin `ref._` — which is what keeps the two forms below disjoint by construction rather
// than by convention. The digest form takes `ref.__`, which for the same reason no escaped name
// can begin either.
const REF_LOCK_ESCAPE_PREFIX = `${REF_LOCK_PREFIX}_`;
const REF_LOCK_DIGEST_PREFIX = `${REF_LOCK_ESCAPE_PREFIX}_`;

/** The last resort for a key whose readable name does not fit a directory entry. Unreadable, and
 * that is the trade: `doctor`'s `locks` check can no longer show which ref it is, but the
 * alternative is `mkdir` failing with `ENAMETOOLONG` and every locking command for that ref
 * erroring out — or, worse, succeeding and then failing on the RENAME the steal protocol needs,
 * which leaves an abandoned lock nothing can reclaim. `MAX_LOCK_NAME_BYTES` (core) is the budget
 * and already reserves room for that suffix. Reached only by a key of roughly 200 characters,
 * which needs a self-hosted url: no forge allows a path that long. */
const digestLockName = (key: RefKey): string =>
  `${REF_LOCK_DIGEST_PREFIX}${createHash('sha256').update(key, 'utf8').digest('hex')}`;

/** Per-ref advisory lock name for `key`. Lock names are joined verbatim onto `locksDir` (see
 * `lock.ts`'s allowlist), so `/` cannot survive — but `_` is legal inside a ref key, and simply
 * substituting one for the other is not injective: `acme_tools/widget` and `acme/tools_widget`
 * both come out as `acme_tools_widget`, and two unrelated refs then serialize against each other.
 *
 * Two forms, in a namespace each:
 *
 *   - **No `_` in the key** — `/` becomes `_`, exactly as before. The only `_` in the result came
 *     from a `/`, so this is injective within the form, and every lock name refs has ever written
 *     for such a key is unchanged.
 *   - **Otherwise** — `ref._` opens the escaped form, in which `_` becomes `_u` and `/` becomes
 *     `_s`. Every `_` in the output therefore opens a complete two-character code, which a
 *     left-to-right scan reads back unambiguously; a literal `_u` in the key encodes as `_uu`.
 *
 * The escape must run before the substitution, or the `_`s it writes would themselves be read as
 * separators. Nothing decodes these names — `doctor`'s `locks` check prints them verbatim — so the
 * grammar is documented here rather than implemented twice.
 *
 * A name too long for a directory entry falls back to a third form, `ref.__` plus a digest — see
 * `digestLockName`. `zRefKey` admits path characters `LOCK_NAME_PATTERN` rejects (`@` and a space
 * among them), which this passes through and `withLock` then refuses; that predates the encoding
 * and is tracked separately.
 *
 * Shared by the dry-run clone step and the finalize identity/head checks so both ever use the
 * exact same name for a given ref. */
const refLockName = (key: RefKey): string => {
  const readable = key.includes('_')
    ? `${REF_LOCK_ESCAPE_PREFIX}${key.replaceAll('_', '_u').replaceAll('/', '_s')}`
    : `${REF_LOCK_PREFIX}${key.replaceAll('/', '_')}`;
  return Buffer.byteLength(readable, 'utf8') > MAX_LOCK_NAME_BYTES ? digestLockName(key) : readable;
};

/** Whether `REFS_ALLOW_FILE_URLS=1` is set — the same escape hatch `canonicalizeGitUrl` itself
 * gates its `file:` support on. Threaded through everywhere this module re-derives a repo's
 * canonical identity (checkout reuse, finalize-time origin/head checks), not just initial source
 * resolution, so `file://` fixtures keep working end to end under test. */
const allowFileUrlsFrom = (env: NodeJS.ProcessEnv): boolean =>
  env['REFS_ALLOW_FILE_URLS'] === ALLOW_FILE_URLS_FLAG;

type ResolvedSource = {
  cloneUrl: string;
  key: RefKey;
  npmDirectory?: string;
  npmPkgName?: string;
};

const resolveGitUrlSource = (ctx: CliContext, source: string): ResolvedSource => {
  const canonical = canonicalizeGitUrl(source, { allowFileUrls: allowFileUrlsFrom(ctx.env) });
  return { cloneUrl: canonical.cloneUrl, key: canonical.key };
};

const resolveNpmSource = async (ctx: CliContext, pkgName: string): Promise<ResolvedSource> => {
  if (pkgName === '') {
    throw usageError('refs add npm: requires a package name, e.g. npm:left-pad');
  }
  progress(ctx, `resolving npm package '${pkgName}'…`);
  const resolved = await resolveNpmPackage(ctx.fetcher, pkgName);
  const result: ResolvedSource = {
    cloneUrl: resolved.cloneUrl,
    key: resolved.key,
    npmPkgName: pkgName,
  };
  if (resolved.directory !== undefined) {
    result.npmDirectory = resolved.directory;
  }
  return result;
};

/** Resolves `<source>` — either `npm:<pkg>` (via the registry) or a direct git url (canonicalized,
 * honouring `REFS_ALLOW_FILE_URLS=1` for `file://` fixtures/tests) — into a clone url + ref key. */
const resolveAddSource = (ctx: CliContext, source: string): Promise<ResolvedSource> => {
  if (source.startsWith(NPM_PREFIX)) {
    return resolveNpmSource(ctx, source.slice(NPM_PREFIX.length));
  }
  return Promise.resolve(resolveGitUrlSource(ctx, source));
};

/** Transport rule: a url the user typed explicitly is used verbatim — typing the url IS
 * choosing the transport — so only `npm:`-resolved sources are rewritten to the configured
 * `git_transport`, before cloning and before the url lands in the proposal/config entry. A NEW
 * ref cannot carry a per-ref override yet, so the global setting governs (`ref` = undefined). The
 * canonical key is transport-invariant (asserted inside `applyGitTransport`), so every guard and
 * path derivation keyed on `resolved.key` is unaffected by the rewrite. */
const applyConfiguredTransport = (resolved: ResolvedSource, settings: Settings): ResolvedSource => {
  if (resolved.npmPkgName === undefined) {
    return resolved;
  }
  const transport = resolveSetting('git_transport', undefined, settings);
  return { ...resolved, cloneUrl: applyGitTransport(resolved.cloneUrl, transport) };
};

const conflictMessage = (key: string): string =>
  `ref '${key}' already exists — use refs edit or refs remove`;

/** Throws `conflictError` when `key` is already a configured ref — checked once (best-effort)
 * before cloning and again under the home lock at finalize time (race-safe). */
const ensureNoConflict = (config: Config, key: RefKey): void => {
  if (config.refs[key] !== undefined) {
    throw conflictError(conflictMessage(key));
  }
};

const readDirSafe = async (dir: string): Promise<Dirent[] | undefined> => {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
};

const dirNamesOf = (entries: readonly Dirent[]): string[] =>
  entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

type SegmentStep =
  | { kind: 'collision'; name: string }
  | { kind: 'continue'; nextDir: string }
  | { kind: 'stop' };

// One step of `descend`'s segment-by-segment walk: reads `currentDir`, then reports whether
// `segment` exactly matches an existing subdirectory (continue descending), matches only
// case-insensitively (a collision), or matches nothing at all (stop — nothing beyond this point
// exists to collide with).
const stepSegment = async (currentDir: string, segment: string): Promise<SegmentStep> => {
  const entries = await readDirSafe(currentDir);
  if (entries === undefined) {
    return { kind: 'stop' };
  }
  const dirNames = dirNamesOf(entries);
  if (dirNames.includes(segment)) {
    return { kind: 'continue', nextDir: join(currentDir, segment) };
  }
  const collided = dirNames.find((name) => name.toLowerCase() === segment.toLowerCase());
  if (collided === undefined) {
    return { kind: 'stop' };
  }
  return { kind: 'collision', name: collided };
};

/** Walks the existing directory tree under `sourcesDir` one key segment at a time (recursively),
 * looking for a directory whose name matches the next segment case-INsensitively but not
 * exactly. */
const descend = async (
  currentDir: string,
  remaining: readonly string[],
  matchedSoFar: readonly string[],
): Promise<string | undefined> => {
  const [segment, ...rest] = remaining;
  if (segment === undefined) {
    return undefined;
  }
  const step = await stepSegment(currentDir, segment);
  if (step.kind === 'stop') {
    return undefined;
  }
  if (step.kind === 'collision') {
    return [...matchedSoFar, step.name].join('/');
  }
  return descend(step.nextDir, rest, [...matchedSoFar, segment]);
};

const NO_MATCHES: readonly string[] = [];

/** Throws `conflictError` when an existing `sources/` directory collides with `key` only in case
 * (e.g. `github.com/Owner/repo` vs. `github.com/owner/repo`) — such checkouts would alias on a
 * case-insensitive filesystem even though the config keys are textually distinct. */
const ensureNoCaseCollision = async (home: RefsHome, key: RefKey): Promise<void> => {
  const collision = await descend(home.sourcesDir, key.split('/'), NO_MATCHES);
  if (collision !== undefined) {
    throw conflictError(
      `checkout path for '${key}' collides case-insensitively with existing '${collision}'`,
    );
  }
};

export {
  allowFileUrlsFrom,
  applyConfiguredTransport,
  ensureNoCaseCollision,
  ensureNoConflict,
  refLockName,
  resolveAddSource,
};
export type { ResolvedSource };
