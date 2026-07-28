import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { RefKey } from './schemas/primitives.ts';
import { homedir } from 'node:os';
import { validationError } from './errors.ts';

const PARENT_DIR_SEGMENT = '..';

type RefsHome = {
  root: string;
  configPath: string;
  statePath: string;
  locksDir: string;
  sourcesDir: string;
  hooksDir: string;
};

// `resolve()` the configured root so a relative REFS_HOME (e.g. "./refs-home") still yields
// absolute derived paths — every command and the containment guards below assume absolute paths.
const resolveHome = (env: NodeJS.ProcessEnv): RefsHome => {
  const root = resolve(env['REFS_HOME'] ?? join(homedir(), '.kaisers-io', 'refs'));
  return {
    configPath: join(root, 'config.toml'),
    hooksDir: join(root, 'hooks'),
    locksDir: join(root, 'locks'),
    root,
    sourcesDir: join(root, 'sources'),
    statePath: join(root, 'state.json'),
  };
};

const checkoutPath = (home: RefsHome, key: RefKey): string =>
  join(home.sourcesDir, ...key.split('/'));

// Single source of truth for the config-backup suffix — both `config-io.ts` (writing the backup)
// and the CLI's migrate command (reporting its path) derive it from here rather than each
// hardcoding `.bak` independently.
const configBackupPath = (home: RefsHome): string => `${home.configPath}.bak`;

// Walks up from `target` until it finds an existing ancestor, collecting the non-existing suffix
// segments along the way (deepest-first order for re-joining later).
const findExistingAncestor = (target: string): { ancestor: string; missing: string[] } => {
  const missing: string[] = [];
  let current = target;
  // eslint-disable-next-line node/no-sync -- containment guard must resolve synchronously before any destructive fs operation proceeds
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      /* Defensive backstop for non-POSIX roots (e.g. Windows drive roots) where
       * dirname(root) === root and the loop would otherwise never terminate. */
      break;
    }
    /* Using basename() here is correct at every boundary, including when parent === '/': slicing
     * on parent.length + separator length under-counts the leading separator once parent already
     * ends in one, silently dropping a character. */
    missing.unshift(basename(current));
    current = parent;
  }
  return { ancestor: current, missing };
};

// Realpath()s the deepest existing ancestor of `target` (resolving symlinks) and re-appends the
// non-existing suffix, so we can realpath paths that don't exist yet, e.g. a checkout that hasn't
// been cloned.
const realpathDeepestExisting = (target: string): string => {
  const { ancestor, missing } = findExistingAncestor(target);
  // eslint-disable-next-line node/no-sync -- containment guard must resolve synchronously before any destructive fs operation proceeds
  const resolved = realpathSync(ancestor);
  if (missing.length === 0) {
    return resolved;
  }
  return join(resolved, ...missing);
};

/**
 * Shared containment core behind `assertInsideSources` and the CLI's package-directory guard.
 * Guarantee: resolves symlinks in the EXISTING path components of both `root` and `absolutePath`
 * (via realpathDeepestExisting) before comparing. For any non-existing suffix of `absolutePath`
 * the check is point-in-time only — a concurrent writer could plant a symlink in that suffix
 * between this check and a later destructive use, so this guard does not fully close TOCTOU
 * races (that would require openat-style traversal, out of scope for a local single-user tool).
 * Destructive callers (e.g. `refs remove`) MUST call this guard against an existing target
 * immediately before the destructive operation, not earlier, to minimise the race window.
 * `rel === ''` (target is the root itself) is rejected too; `label` names the boundary in the
 * thrown message (e.g. "sources directory").
 */
const assertInsideDir = (root: string, absolutePath: string, label: string): void => {
  const rootReal = realpathDeepestExisting(root);
  const targetReal = realpathDeepestExisting(absolutePath);
  const rel = relative(rootReal, targetReal);
  // `rel.startsWith('..')` alone is wrong: a ref-key segment literally named `..name`
  // also starts with `..` without escaping rootReal (zRefKey's SAFE_SEGMENT only
  // rejects an exact `.` or `..`). Only an exact `..` or a `..` followed by a path
  // separator means escape.
  const isParentOrAbove = rel === PARENT_DIR_SEGMENT || rel.startsWith(PARENT_DIR_SEGMENT + sep);
  const contained = rel !== '' && !isParentOrAbove && !isAbsolute(rel);
  if (!contained) {
    throw validationError(`path escapes ${label} (containment violation): ${absolutePath}`);
  }
};

/** Containment guard for the sources directory — a thin binding of `assertInsideDir` to
 * `home.sourcesDir`; every guarantee (and TOCTOU caveat) documented there applies verbatim. */
const assertInsideSources = (home: RefsHome, absolutePath: string): void => {
  assertInsideDir(home.sourcesDir, absolutePath, 'sources directory');
};

export { assertInsideDir, assertInsideSources, checkoutPath, configBackupPath, resolveHome };
export type { RefsHome };
