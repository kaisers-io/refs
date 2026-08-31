import { dirname, isAbsolute, join, parse, sep } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { usageError } from '@kaisers-io/refs-core';

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
// Rejects anything that could climb out of `node_modules` or address a path rather than a package:
// a package name reaches this from `config.toml`, where keys are only checked for being non-empty
// and not a prototype key — not for being valid npm names.
const UNSAFE_SEGMENT = new Set(['', '.', '..']);

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
  !isAbsolute(name) &&
  !name.includes('\\') &&
  name.split('/').every((segment) => !UNSAFE_SEGMENT.has(segment));

/** Ancestor directories of `from`, nearest first, with any `node_modules` segment skipped —
 * Node's own lookup does not nest `node_modules/node_modules`, and a naive walk from inside an
 * installed package would otherwise probe paths that can never exist. */
const lookupDirs = function* lookupDirs(from: string): Generator<string> {
  let current = from;
  const { root } = parse(from);
  while (true) {
    if (!current.split(sep).includes(NODE_MODULES)) {
      yield join(current, NODE_MODULES);
    }
    if (current === root) {
      return;
    }
    current = dirname(current);
  }
};

const readManifest = async (path: string): Promise<InstalledInfo> => {
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

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
    if (await exists(join(project, '.pnp.cjs'))) {
      return true;
    }
  }
  return false;
};

/** Validates `--project` before anything else happens. A path that does not exist, or is not a
 * directory, is a mistake in the invocation rather than a fact about the project — and it must be
 * caught before a `--sync-if-stale` in the same call goes and mutates a checkout for it. */
const assertProjectDir = async (project: string): Promise<void> => {
  try {
    const info = await stat(project);
    if (!info.isDirectory()) {
      throw usageError(`--project must be a directory: ${project}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('--project')) {
      throw error;
    }
    throw usageError(`--project path does not exist: ${project}`);
  }
};

/** The installed version of `packageName` as seen from `project`.
 *
 * Stops at the first `node_modules/<name>` that EXISTS, rather than the first readable manifest.
 * Falling through to an ancestor would report a different, shadowed installation — the one Node
 * would not have loaded — which is a wrong answer dressed as a found one. */
const resolveInstalled = async (project: string, packageName: string): Promise<InstalledInfo> => {
  if (!isSafePackageName(packageName)) {
    return { reason: 'unsupported_package_name', status: 'unverifiable' };
  }
  for (const dir of lookupDirs(project)) {
    const slot = join(dir, ...packageName.split('/'));
    // eslint-disable-next-line no-await-in-loop -- Node's lookup order is sequential by definition
    if (await exists(slot)) {
      // eslint-disable-next-line no-await-in-loop -- as above
      return await readManifest(join(slot, 'package.json'));
    }
  }
  return (await hasPnpManifest(project))
    ? { reason: 'yarn_pnp', status: 'unsupported_layout' }
    : { status: 'not_materialized' };
};

export { assertProjectDir, resolveInstalled };
export type { InstalledInfo, InstalledStatus };
