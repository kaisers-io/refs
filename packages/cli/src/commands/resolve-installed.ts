import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { errnoCode, isEnoent, isSafeSegment, usageError } from '@kaisers-io/refs-core';
import { readFile, readdir, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

// Which version of a package a project actually has installed.
//
// This exists because the alternative was worse: the skill used to tell the agent to read the
// project's lockfile by hand, and nothing in refs touched one. So the deterministic half of every
// "what changed between my version and a newer one" question was done by the least deterministic
// component in the system — against pnpm's peer-qualified keys, importer-scoped resolutions,
// aliases and overrides, in three vendor-specific formats.
//
// The answer here is read from `node_modules`, not from a lockfile, and the distinction is the
// whole point: a lockfile says what SHOULD be installed, `node_modules` says what IS. The second is
// the question being asked. There is deliberately no lockfile fallback, because adding one would
// drag back exactly the ambiguity this removes — an honest "not installed here" is more useful than
// a confident guess.

const NODE_MODULES = 'node_modules';
// Yarn 2+ writes `.pnp.cjs`; Yarn 1 wrote `.pnp.js`.
const PNP_MANIFESTS = ['.pnp.cjs', '.pnp.js'];
// Rejects anything that could climb out of `node_modules` or address a path rather than a package:
// a package name reaches this from `config.toml`, where keys are only checked for being non-empty
// and not a prototype key — not for being valid npm names.
//
// `isSafeSegment` is core's own rule, the one `zRefKey` and `zPackagePath` apply, rather than a
// second definition here. The local one admitted `:` and `%`, which core rejects and documents:
// `:` is a Windows drive and NTFS alternate-data-stream separator, so a config-derived name like
// `C:foo` addressed a stream rather than a directory. No escape from the `node_modules` prefix
// resulted and there is no POSIX effect, but two spellings of one rule is how the narrower one
// ends up being the only one anybody updates.

type InstalledStatus = 'found' | 'not_materialized' | 'unsupported_layout' | 'unverifiable';

type InstalledInfo = {
  /** The manifest's OWN name. It can differ from the queried name when the dependency was installed
   * under an alias, which is worth reporting rather than silently equating. */
  name?: string;
  package_json?: string;
  reason?: string;
  status: InstalledStatus;
  version?: string;
};

const isSafePackageName = (name: string): boolean =>
  !isAbsolute(name) && name.split('/').every((segment) => isSafeSegment(segment));

/** The `node_modules` directories Node would consult from `from`, nearest first.
 *
 * The path is made absolute first: `dirname('.')` is `'.'` and `parse('.').root` is empty, so a
 * relative start had no terminating condition at all — `--project .` looped forever.
 *
 * Only the redundant `node_modules/node_modules` candidate is skipped, which is exactly what Node
 * skips. Skipping every directory that merely SITS under a `node_modules` would miss a nested
 * dependency's own installs: from `…/node_modules/pkg/src`, Node still consults
 * `…/node_modules/pkg/src/node_modules` and `…/node_modules/pkg/node_modules`. */
const lookupDirs = function* lookupDirs(from: string): Generator<string> {
  let current = resolve(from);
  while (true) {
    if (basename(current) !== NODE_MODULES) {
      yield join(current, NODE_MODULES);
    }
    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
};

/** `undefined` means "no manifest here" — the slot exists but holds nothing Node could load from,
 * so the walk continues, as Node's own `LOAD_NODE_MODULES` does. Anything else is an answer. */
const readManifest = async (path: string): Promise<InstalledInfo | undefined> => {
  if ((await probe(path)) === 'absent') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const record =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const { name, version } = record;
    if (typeof version !== 'string' || version === '') {
      return { package_json: path, reason: 'manifest_has_no_version', status: 'unverifiable' };
    }
    return {
      ...(typeof name === 'string' ? { name } : {}),
      package_json: path,
      status: 'found',
      version,
    };
  } catch {
    return { package_json: path, reason: 'manifest_unreadable', status: 'unverifiable' };
  }
};

// Absence and "could not look" are different answers. Collapsing them would let a permissions
// fault on the nearest installation fall through to an ancestor and report a version Node would
// never have loaded — precisely the shadowing this walk stops at the first slot to avoid.
const NOT_THERE = new Set(['ENOENT', 'ENOTDIR']);

const isEmptyDir = async (path: string): Promise<boolean> => {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch {
    return false;
  }
};

const probe = async (path: string): Promise<'absent' | 'present' | 'unreadable'> => {
  try {
    await stat(path);
    return 'present';
  } catch (error) {
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined;
    return code !== undefined && NOT_THERE.has(code) ? 'absent' : 'unreadable';
  }
};

/** Yarn Plug'n'Play keeps no `node_modules` at all, so an empty walk there means "differently
 * installed", not "not installed". Checked only AFTER the walk finds nothing: a project mid-
 * migration can carry both, and a materialized install is the better answer when one exists.
 *
 * The manifests are detected, never loaded. `.pnp.cjs` is project code, and reading a version out
 * of it would mean executing it. */
const hasPnpManifest = async (from: string): Promise<boolean> => {
  for (const dir of lookupDirs(from)) {
    const project = dirname(dir);
    // eslint-disable-next-line no-await-in-loop -- the walk is inherently ordered, nearest first
    // `.pnp.cjs` is Yarn 2+; Yarn 1 wrote `.pnp.js`. Both are detected, neither is loaded.
    // eslint-disable-next-line no-await-in-loop -- the walk is ordered, nearest first
    const manifests = await Promise.all(PNP_MANIFESTS.map((name) => probe(join(project, name))));
    if (manifests.includes('present')) {
      return true;
    }
  }
  return false;
};

/** Validates `--project` before anything else happens. A path that does not exist, or is not a
 * directory, is a mistake in the invocation rather than a fact about the project — and it must be
 * caught before a `--sync-if-stale` in the same call goes and mutates a checkout for it.
 *
 * The `stat` is kept inside its own try, so what follows it is not in the catch's reach. That used
 * to be arranged by asking whether the caught error's MESSAGE began with `--project`, which is a
 * string sniff over refs' own wording — and it swallowed every non-ENOENT failure into "path does
 * not exist", reporting an EACCES or an ELOOP as an absence. */
const statOrUndefined = async (path: string): Promise<Stats | undefined> => {
  try {
    return await stat(path);
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw usageError(`--project could not be read: ${path} (${errnoCode(error) ?? 'unknown'})`);
  }
};

const assertProjectDir = async (project: string): Promise<void> => {
  const info = await statOrUndefined(project);
  if (info === undefined) {
    throw usageError(`--project path does not exist: ${project}`);
  }
  if (!info.isDirectory()) {
    throw usageError(`--project must be a directory: ${project}`);
  }
};

/** One `node_modules/<name>` candidate: an answer, or `undefined` to keep walking. */
const inspectSlot = async (slot: string): Promise<InstalledInfo | undefined> => {
  const found = await probe(slot);
  if (found === 'unreadable') {
    return { reason: 'slot_unreadable', status: 'unverifiable' };
  }
  if (found === 'absent') {
    return undefined;
  }
  const manifest = await readManifest(join(slot, 'package.json'));
  if (manifest !== undefined) {
    return manifest;
  }
  // No manifest — but Node can still load a package directory from `index.js` or a `main`-less
  // layout, and such a slot shadows anything further up. Walking past it would report an ancestor's
  // version for a module Node would not load. Only a genuinely EMPTY directory is transparent.
  return (await isEmptyDir(slot))
    ? undefined
    : { reason: 'installed_without_manifest', status: 'unverifiable' };
};

/** The installed version of `packageName` as seen from `project`.
 *
 * Stops at the first slot Node itself would load from — which is not merely the first that exists.
 * Node tries each `node_modules` candidate and continues upward when one cannot resolve, so an
 * empty `node_modules/<name>` does not shadow a real installation further up and must not stop the
 * walk here either.
 *
 * A slot whose manifest is present but unusable DOES stop it: that is the installation Node would
 * have loaded, and reporting an ancestor's version instead would be a wrong answer dressed as a
 * found one. */
const resolveInstalled = async (project: string, packageName: string): Promise<InstalledInfo> => {
  if (!isSafePackageName(packageName)) {
    return { reason: 'unsupported_package_name', status: 'unverifiable' };
  }
  for (const dir of lookupDirs(project)) {
    // eslint-disable-next-line no-await-in-loop -- Node's lookup order is sequential by definition
    const candidate = await inspectSlot(join(dir, ...packageName.split('/')));
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return (await hasPnpManifest(project))
    ? { reason: 'yarn_pnp', status: 'unsupported_layout' }
    : { status: 'not_materialized' };
};

export { assertProjectDir, resolveInstalled };
export type { InstalledInfo, InstalledStatus };
