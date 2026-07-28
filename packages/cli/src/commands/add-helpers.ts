import type { Config, RefKey, RefsHome, Settings } from '@kaisers-io/refs-core';
import {
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
import { join } from 'node:path';
import { progress } from '../output.ts';
import { readdir } from 'node:fs/promises';

// Source resolution + pre-clone guards for `add.ts` — split out purely to keep that file under the
// repo's 300-line oxlint cap. Checkout-identity/head-sha guards (origin verification, the
// managed-checkout marker, `resolveCheckoutHead`) live in `add-checkout-guards.ts`; package/
// proposal shaping in `add-packages.ts`; proposal-file/stdin loading in `add-proposal-io.ts`.

const NPM_PREFIX = 'npm:';
const REF_LOCK_PREFIX = 'ref:';
const ALLOW_FILE_URLS_FLAG = '1';

/** Per-ref advisory lock name for `key` — `/` replaced by `_` since lock names are joined verbatim
 * onto `locksDir` (see `lock.ts`'s allowlist). Shared by the dry-run clone step and the finalize
 * identity/head checks so both ever use the exact same name for a given ref. */
const refLockName = (key: RefKey): string => `${REF_LOCK_PREFIX}${key.replaceAll('/', '_')}`;

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

/** Spec §3 transport rule: a url the user typed explicitly is used verbatim — typing the url IS
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

// One step of the segment-by-segment descent below, split out purely to keep `descend` itself
// under the max-statements cap: reads `currentDir`, then reports whether `segment` exactly
// matches an existing subdirectory (continue descending), matches only case-insensitively (a
// collision), or matches nothing at all (stop — nothing beyond this point exists to collide with).
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

/** Walks the existing directory tree under `sourcesDir` one key segment at a time (recursively, so
 * no single function carries the whole loop's statement count), looking for a directory whose name
 * matches the next segment case-INsensitively but not exactly. */
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
  conflictMessage,
  ensureNoCaseCollision,
  ensureNoConflict,
  refLockName,
  resolveAddSource,
};
export type { ResolvedSource };
