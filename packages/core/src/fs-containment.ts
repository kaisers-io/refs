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
import { dirname, isAbsolute, parse, relative, sep } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

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

// Does a directory entry exist at this exact path, without following it? True for a dangling
// symlink, false when nothing is there at all.
const lstatExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
};

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
    if (!MISSING_PATH_CODES.has(resolvedTarget.code)) {
      return { code: resolvedTarget.code, kind: 'unreadable' };
    }
    // ENOENT from `realpath` covers two different things: nothing is there, and something IS
    // there but its target does not resolve — a dangling symlink. `lstat` separates them
    // without following the link. A dangling link is a failure to resolve, not an absence, and
    // the difference matters: absence is evidence a caller acts on ("the package is gone"),
    // while a broken link is only evidence that we could not tell.
    return (await lstatExists(target))
      ? { code: resolvedTarget.code, kind: 'unreadable' }
      : { kind: 'missing' };
  }

  return isInside(resolvedRoot.real, resolvedTarget.real)
    ? { kind: 'inside', real: resolvedTarget.real }
    : { kind: 'outside' };
};

// Only the host's own separators. Windows accepts both spellings and `sep` is the backslash
// there; POSIX has just the one, and the Set collapses the duplicate. Taking the backslash on
// POSIX too would rewrite a trailing `b\\/` into `b`, naming a different basename — there it is
// an ordinary filename character.
const SEPARATORS: ReadonlySet<string> = new Set(['/', sep]);

/** `path` without its trailing separators, stopping at the filesystem root so that removing them
 * cannot change what the path names.
 *
 * The root comes from `parse`, which knows every spelling the host has: `/`, `C:\\`, a drive-RELATIVE
 * `C:` that carries no separator to strip, and a UNC share root. An earlier version approximated it
 * as "the trimmed path ends in `:`" and so fired for ANY basename ending in a colon — a symlink
 * named `deadlink:` kept its trailing slash, `lstat` followed it as a directory, and the dangling
 * link it pointed at was reported as an absence INSIDE the package. `:` is not excluded by the
 * manifest gate, so that target reached this code from a declared `exports` entry.
 *
 * Scanned rather than matched with `/[/\\]+$/`, which is a polynomial ReDoS: anchoring a
 * quantified class at the end makes the engine retry from every position, and the target here is
 * a path built from a declared `exports` target. Measured on that regex: 156 ms for 10 000 leading
 * separators, 15.6 s for 100 000. This is linear. */
const withoutTrailingSeparators = (path: string): string => {
  const rootLength = parse(path).root.length;
  let end = path.length;
  while (end > rootLength && SEPARATORS.has(path.charAt(end - 1))) {
    end -= 1;
  }
  return path.slice(0, end);
};

/** Whether an ABSENCE at `path` is an absence INSIDE the package.
 *
 * `missing` is a pure existence answer: `resolveInside` returns it from a `realpath` ENOENT plus a
 * failed no-follow `lstat`, computed independently of any containment comparison. Consuming it
 * first split every out-of-package path in two — something is there gave `unverifiable`, nothing
 * is there gave `absent` — and `join` clamps `..` at the filesystem root, so one target named any
 * absolute path from any package depth.
 *
 * A path that does not exist cannot be resolved, so containment is asked of the nearest ancestor
 * that DOES. Walking up rather than checking the immediate parent matters: a missing target's
 * parent is usually missing too, and stopping there would report every nested absence as
 * uninspected. Resolving an ancestor is also what a lexical `..` guard cannot do — a symlink
 * inside the package pointing out of it needs no `..` in the declared target at all.
 *
 * The walk starts at the path ITSELF, with trailing separators removed, and that is load-bearing.
 * `./link/` keeps its slash through `join`, and a trailing slash makes `lstat` resolve the symlink
 * as a directory instead of inspecting the link — so a link pointing at a directory that does not
 * exist came back `missing` rather than as the dangling link it is, and `dirname` then stepped
 * straight over the link to the package directory. That reported `absent` about an external
 * directory while an existing one gave `unverifiable`: the same oracle, one component higher. */
const absenceIsInside = async (packageDir: string, path: string): Promise<boolean> => {
  let at = withoutTrailingSeparators(path);
  // eslint-disable-next-line no-await-in-loop -- each step depends on the previous one's result
  for (let located = await resolveInside(packageDir, at); ;) {
    if (located.kind !== 'missing' || dirname(at) === at) {
      return located.kind === 'inside';
    }
    at = dirname(at);
    // eslint-disable-next-line no-await-in-loop -- walking up is sequential by nature
    located = await resolveInside(packageDir, at);
  }
};

export { absenceIsInside, resolveInside, withoutTrailingSeparators };
export type { ContainmentResult };
