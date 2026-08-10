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

// Why a scan carries diagnostics at all: detection collapses every failure — an unreadable
// workspace declaration, an unreadable manifest, a containment rejection, an unsupported
// pattern — into the same empty result. That is right for `add`, which is best-effort and has
// an agent to fill the gaps, but a consumer that DIFFS a scan against config cannot then tell a
// transient read error from "every package was removed". These diagnostics are that missing
// distinction.
type WorkspaceDiagnostic =
  // A directory entry that WOULD have been a package candidate but was never inspected, because
  // candidate selection cannot see it: `readdir` uses lstat semantics, so a symlinked directory
  // is not `isDirectory()` and never becomes a candidate. Reported rather than skipped silently
  // — a scan that omits a possible package is not complete, and callers now draw conclusions
  // ("this package is gone", "this is its one new home") from completeness.
  | { kind: 'candidate_not_inspected'; path: string }
  // A candidate directory declared no usable `name`. Not a read failure: the manifest was read
  // fine, it just is not a package. Distinct from `manifest_unreadable` so nobody is told
  // something failed when nothing did.
  | { kind: 'manifest_missing_name'; path: string }
  | { kind: 'manifest_unreadable'; path: string }
  | { kind: 'no_workspace_declaration' }
  | { kind: 'unsupported_pattern'; pattern: string }
  | { kind: 'workspace_dir_unreadable'; path: string }
  | { kind: 'workspace_file_unreadable'; file: string };

type WorkspaceScan = {
  diagnostics: WorkspaceDiagnostic[];
  packages: WorkspacePackage[];
};

// Two kinds are deliberately absent, because both are COMPLETE observations rather than
// failures to observe:
//
//   `no_workspace_declaration` — a repo with no workspaces is an ordinary single-package repo,
//   and its empty scan is the correct answer.
//
//   `manifest_missing_name` — the manifest was read successfully and declares no usable name.
//   There is no resolvable package at that path, and we know it. Marking this unreliable would
//   be worse than noise: one nameless `package.json` under a workspace glob would make a repo's
//   scan permanently unreliable, suppressing every removal detection built on top of it. Such
//   manifests are real (zod's own repo root has no `name`), so this would not be a rare case.
//
// Every OTHER diagnostic means the scan may be INCOMPLETE — some path that could hold a package
// was not inspected — so a name's absence from it proves nothing, and a name's single appearance
// in it does not prove uniqueness either.
const UNRELIABLE_DIAGNOSTIC_KINDS: ReadonlySet<WorkspaceDiagnostic['kind']> = new Set([
  'candidate_not_inspected',
  'manifest_unreadable',
  'unsupported_pattern',
  'workspace_dir_unreadable',
  'workspace_file_unreadable',
]);

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

/** Whether a scan's package list may be treated as complete. An unreliable scan must never be
 * used to conclude that a configured package is gone. */
const scanIsReliable = (scan: WorkspaceScan): boolean =>
  !scan.diagnostics.some((diagnostic) => UNRELIABLE_DIAGNOSTIC_KINDS.has(diagnostic.kind));

// Codepoint comparison, NOT `localeCompare`. Without an explicit locale `localeCompare` uses
// the host's collation, which the spec leaves implementation-defined — and it genuinely
// reorders exactly the characters that occur in package names and paths. Measured on Node 24
// (ICU 77.1, en-US), `['pkgb','pkg_b','pkg-b','Pkg']` sorts to `['Pkg','pkg-b','pkg_b','pkgb']`
// by codepoint but `['pkg-b','Pkg','pkg_b','pkgb']` by collation. CI runs macOS, Linux and
// Windows, and diagnostics are compared as exact arrays, so the order must not depend on the
// host.
const SORT_LEFT_FIRST = -1;
const SORT_RIGHT_FIRST = 1;
const SORT_EQUAL = 0;

const compareCodepoint = (left: string, right: string): number => {
  if (left < right) {
    return SORT_LEFT_FIRST;
  }
  return left > right ? SORT_RIGHT_FIRST : SORT_EQUAL;
};

// Stable identity per diagnostic: kind first (groups related failures), then whichever field
// names the thing that failed.
const diagnosticSortKey = (diagnostic: WorkspaceDiagnostic): string => {
  if ('path' in diagnostic) {
    return `${diagnostic.kind} ${diagnostic.path}`;
  }
  if ('file' in diagnostic) {
    return `${diagnostic.kind} ${diagnostic.file}`;
  }
  if ('pattern' in diagnostic) {
    return `${diagnostic.kind} ${diagnostic.pattern}`;
  }
  return diagnostic.kind;
};

/** Deterministic diagnostic order. Candidate diagnostics otherwise inherit `readdir` order,
 * which is not a portable contract — the same repo could report a different order per platform. */
const sortDiagnostics = (diagnostics: readonly WorkspaceDiagnostic[]): WorkspaceDiagnostic[] =>
  diagnostics.toSorted((left, right) =>
    compareCodepoint(diagnosticSortKey(left), diagnosticSortKey(right)),
  );

export {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  compareCodepoint,
  deduplicateAndSort,
  isRelPathContained,
  isSafeWorkspacePattern,
  scanIsReliable,
  selectPackageDirs,
  sortDiagnostics,
  toWorkspacePackage,
};
export type {
  PackageManifestInfo,
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspacePatternPlan,
  WorkspaceScan,
};
