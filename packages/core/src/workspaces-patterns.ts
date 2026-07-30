// Pure decision logic behind workspace package detection: glob-form classification, containment
// decisions over already-resolved relative paths, candidate-directory selection, and result
// shaping. No filesystem access happens here — `workspaces.ts` owns the IO (readdir walks,
// manifest probes, realpath containment guards) and feeds this module plain values.
import { isAbsolute, posix, sep } from 'node:path';

type WorkspacePackage = {
  // Missing description is `undefined` (omitted in JSON), matching the proposal schema's
  // optional description (`zPackageEntry.partial({ description: true })` in proposal.ts).
  description: string | undefined;
  name: string;
  path: string;
};

// Name/description probed from a package manifest; a non-string field is `undefined`.
type PackageManifestInfo = {
  description: string | undefined;
  name: string | undefined;
};

// The decided fate of one workspace pattern: expand a base directory one level, probe a single
// literal directory, or ignore the pattern entirely.
type WorkspacePatternPlan =
  | { baseDir: string; kind: 'expand-children' }
  | { dir: string; kind: 'probe-dir' }
  | { kind: 'ignore' };

const GLOB_SUFFIX = '/*';
const BARE_GLOB = '*';
const CURRENT_DIR_SEGMENT = '.';
const PARENT_DIR_SEGMENT = '..';
const PATH_SEGMENT_SEPARATOR_PATTERN = /[/\\]/u;
const MAX_WILDCARDS_PER_PATTERN = 1;

const IGNORE: WorkspacePatternPlan = { kind: 'ignore' };

// Reject any workspace pattern that is absolute or contains `.`/`..` path segments before
// it is ever used in a filesystem call. Defense in depth; `isContainedInRepo` in
// `workspaces.ts` still re-checks each resolved candidate via realpath.
const isSafeWorkspacePattern = (pattern: string): boolean => {
  if (isAbsolute(pattern)) {
    return false;
  }

  const segments = pattern.split(PATH_SEGMENT_SEPARATOR_PATTERN);
  return segments.every(
    (segment) => segment !== CURRENT_DIR_SEGMENT && segment !== PARENT_DIR_SEGMENT,
  );
};

// A pattern is supported only when it is safe, is not a negation, has no `**`, and stays within
// the wildcard budget (v1 simplification). The check order preserves the original precedence.
const isSupportedPatternShape = (pattern: string): boolean =>
  isSafeWorkspacePattern(pattern) &&
  !pattern.startsWith('!') &&
  !pattern.includes('**') &&
  (pattern.match(/\*/gu) ?? []).length <= MAX_WILDCARDS_PER_PATTERN;

// Flat dispatch over the supported glob forms; the check order IS the precedence order:
// `<dir>/*` and bare `*` expand one level (bare `*`, a flat workspaces layout, expands the repo
// root `.` as glob base, same as `<dir>/*`), a wildcard-free pattern probes a single literal
// directory, and any other wildcard placement is ignored.
const classifyWorkspacePattern = (pattern: string): WorkspacePatternPlan => {
  if (!isSupportedPatternShape(pattern)) {
    return IGNORE;
  }

  if (pattern.endsWith(GLOB_SUFFIX)) {
    return { baseDir: pattern.slice(0, -GLOB_SUFFIX.length), kind: 'expand-children' };
  }

  if (pattern === BARE_GLOB) {
    return { baseDir: CURRENT_DIR_SEGMENT, kind: 'expand-children' };
  }

  return pattern.includes('*') ? IGNORE : { dir: pattern, kind: 'probe-dir' };
};

// Pure containment decision over an already-computed `relative(repoReal, targetReal)` result.
// `allowSelf` accepts the empty relative path (the target IS the repo root); see
// `isContainedInRepo` in `workspaces.ts` for why only the bare `*` glob base passes `true`.
const isRelPathContained = (rel: string, allowSelf: boolean): boolean => {
  if (allowSelf && rel === '') {
    return true;
  }

  // `rel.startsWith('..')` alone is wrong: an in-repo entry literally named `..packages`
  // also starts with `..` without escaping repoReal. Only an exact `..` or a `..`
  // followed by a path separator means escape.
  const isParentOrAbove = rel === PARENT_DIR_SEGMENT || rel.startsWith(PARENT_DIR_SEGMENT + sep);

  return rel !== '' && !isParentOrAbove && !isAbsolute(rel);
};

// Pair a glob base's child directory names with their package.json probe results: keep the
// names whose probe succeeded, each joined under the base dir, preserving input order.
// `posix.join`, not `join`: package paths are repo-relative *identifiers* (stored in config/state,
// compared and sorted as strings) — always `/`-separated, like ref keys, on every platform. Only
// the fs layer (`workspaces.ts`) joins them onto real directories, and `node:path.join` accepts
// `/`-separated segments on Windows.
const selectPackageDirs = (
  baseDir: string,
  dirNames: string[],
  hasManifestFlags: boolean[],
): string[] =>
  dirNames
    .filter((_name, index) => hasManifestFlags[index] === true)
    .map((name) => posix.join(baseDir, name));

// Shape a probed manifest into a WorkspacePackage; a missing manifest or a missing/empty name
// rejects the directory.
const toWorkspacePackage = (
  packageDir: string,
  info?: PackageManifestInfo,
): WorkspacePackage | undefined =>
  info?.name ? { description: info.description, name: info.name, path: packageDir } : undefined;

// Deduplicate by path (last entry wins) and sort by path
const deduplicateAndSort = (packages: WorkspacePackage[]): WorkspacePackage[] => {
  const mapEntries = packages.map((pkg) => [pkg.path, pkg] as const);
  const deduped = [...new Map<string, WorkspacePackage>(mapEntries).values()];
  deduped.sort((packageA, packageB) => packageA.path.localeCompare(packageB.path));
  return deduped;
};

export {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  deduplicateAndSort,
  isRelPathContained,
  isSafeWorkspacePattern,
  selectPackageDirs,
  toWorkspacePackage,
};
export type { PackageManifestInfo, WorkspacePackage, WorkspacePatternPlan };
