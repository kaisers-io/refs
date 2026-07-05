import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { RefKey } from './schemas/primitives.ts';
import { homedir } from 'node:os';
import { validationError } from './errors.ts';

const NO_MISSING_SEGMENTS = 0;
const PARENT_DIR_SEGMENT = '..';

interface RefsHome {
  root: string;
  configPath: string;
  statePath: string;
  locksDir: string;
  sourcesDir: string;
  hooksDir: string;
}

const resolveHome = (env: NodeJS.ProcessEnv): RefsHome => {
  const root = env['REFS_HOME'] ?? join(homedir(), '.kaisers-io', 'refs');
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

// Walks up from `target` until it finds an existing ancestor, collecting the non-existing suffix segments along the way (deepest-first order for re-joining later).
const findExistingAncestor = (target: string): { ancestor: string; missing: string[] } => {
  const missing: string[] = [];
  let current = target;
  // eslint-disable-next-line node/no-sync -- containment guard must resolve synchronously before any destructive fs operation proceeds
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      /* Defensive backstop for non-POSIX roots (e.g. Windows drive roots) where dirname(root) === root and the loop would otherwise never terminate. */
      break;
    }
    /* Using basename() here is correct at every boundary, including when parent === '/': slicing on parent.length + separator length under-counts the leading separator once parent already ends in one, silently dropping a character. */
    missing.unshift(basename(current));
    current = parent;
  }
  return { ancestor: current, missing };
};

// Realpath()s the deepest existing ancestor of `target` (resolving symlinks) and re-appends the non-existing suffix, so we can realpath paths that don't exist yet, e.g. a checkout that hasn't been cloned.
const realpathDeepestExisting = (target: string): string => {
  const { ancestor, missing } = findExistingAncestor(target);
  // eslint-disable-next-line node/no-sync -- containment guard must resolve synchronously before any destructive fs operation proceeds
  const resolved = realpathSync(ancestor);
  if (missing.length === NO_MISSING_SEGMENTS) {
    return resolved;
  }
  return join(resolved, ...missing);
};

/**
 * Guarantee: resolves symlinks in the EXISTING path components of both `home.sourcesDir` and
 * `absolutePath` (via realpathDeepestExisting) before comparing. For any non-existing suffix of
 * `absolutePath` the check is point-in-time only — a concurrent writer could plant a symlink in
 * that suffix between this check and a later destructive use, so this guard does not fully close
 * TOCTOU races (that would require openat-style traversal, out of scope for a local single-user
 * tool). Destructive callers (e.g. `refs remove`) MUST call this guard against an existing target
 * immediately before the destructive operation, not earlier, to minimise the race window.
 * `rel === ''` (target is sourcesDir itself) is rejected too.
 */
const assertInsideSources = (home: RefsHome, absolutePath: string): void => {
  const sourcesReal = realpathDeepestExisting(home.sourcesDir);
  const targetReal = realpathDeepestExisting(absolutePath);
  const rel = relative(sourcesReal, targetReal);
  // `rel.startsWith('..')` alone is wrong: a ref-key segment literally named `..name`
  // also starts with `..` without escaping sourcesReal (zRefKey's SAFE_SEGMENT only
  // rejects an exact `.` or `..`). Only an exact `..` or a `..` followed by a path
  // separator means escape.
  const isParentOrAbove = rel === PARENT_DIR_SEGMENT || rel.startsWith(PARENT_DIR_SEGMENT + sep);
  const contained = rel !== '' && !isParentOrAbove && !isAbsolute(rel);
  if (!contained) {
    throw validationError(
      `path escapes sources directory (containment violation): ${absolutePath}`,
    );
  }
};

export { assertInsideSources, checkoutPath, resolveHome };
export type { RefsHome };
