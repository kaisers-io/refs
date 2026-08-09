// Resolve a path and say WHY it could not be used, instead of collapsing every outcome into a
// boolean. `isContainedInRepo` in `workspaces.ts` answers "may I read this?", which is the right
// question for best-effort detection but the wrong one for diagnostics: it catches every
// `realpath` failure alike, so it cannot distinguish "not there" (an ordinary repo without a
// `pnpm-workspace.yaml`) from "there but unusable" (EACCES, a symlink out of the tree). Anything
// that diffs a scan against config needs that distinction — without it, every normal repo looks
// like a detection failure.
//
// Resolution deliberately happens BEFORE any read, so a symlink pointing out of the tree is
// rejected without its contents ever being touched — the same discipline `workspaces.ts` follows
// and `workspaces-containment.test.ts` pins.
import { isAbsolute, relative, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

const PARENT_DIR_SEGMENT = '..';

// `realpath` rejects with ENOENT for a path that does not exist, for one whose parent does not
// exist, and for a broken symlink; with ENOTDIR when an intermediate component is a file. All
// four mean "nothing is there", which is a normal state — not a failure to be reported.
const MISSING_PATH_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

type ContainmentResult =
  | { kind: 'inside'; real: string }
  | { kind: 'missing' }
  | { kind: 'outside' }
  | { code: string; kind: 'unreadable' };

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException).code ?? String(error);

const isInside = (realRoot: string, realTarget: string): boolean => {
  const rel = relative(realRoot, realTarget);
  if (rel === '') {
    // The target IS the root — a single-package repo stored as `path: "."`.
    return true;
  }
  return (
    rel !== PARENT_DIR_SEGMENT && !rel.startsWith(PARENT_DIR_SEGMENT + sep) && !isAbsolute(rel)
  );
};

/** Resolves `target` and classifies it relative to `root`.
 *
 * Caveat worth stating rather than discovering later: `realpath` resolves ordinary symlinks and
 * Windows reparse points, but canonical paths are not guaranteed unique — no case folding
 * happens on a case-insensitive filesystem, and 8.3 short names can alias long ones. The failure
 * direction is conservative (an unrecognised alias reports `outside`, never a false `inside`),
 * and this is not an identity boundary for hard links or bind mounts. */
// `realpath` as a result rather than an exception, so each caller can classify the failure
// itself: a missing target is a normal state, a missing root is not.
const tryRealpath = async (path: string): Promise<{ code: string } | { real: string }> => {
  try {
    return { real: await realpath(path) };
  } catch (error) {
    return { code: errorCode(error) };
  }
};

const resolveInside = async (root: string, target: string): Promise<ContainmentResult> => {
  const resolvedRoot = await tryRealpath(root);
  if ('code' in resolvedRoot) {
    // A root that cannot be resolved is never "missing": the caller asked us to check something
    // against it, so failing to resolve it means we could not check, full stop.
    return { code: resolvedRoot.code, kind: 'unreadable' };
  }

  const resolvedTarget = await tryRealpath(target);
  if ('code' in resolvedTarget) {
    return MISSING_PATH_CODES.has(resolvedTarget.code)
      ? { kind: 'missing' }
      : { code: resolvedTarget.code, kind: 'unreadable' };
  }

  return isInside(resolvedRoot.real, resolvedTarget.real)
    ? { kind: 'inside', real: resolvedTarget.real }
    : { kind: 'outside' };
};

export { resolveInside };
export type { ContainmentResult };
