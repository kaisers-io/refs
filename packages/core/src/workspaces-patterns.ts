// Pure decision logic behind workspace package detection: glob-form classification, containment
// decisions over already-resolved relative paths, candidate-directory selection, and result
// shaping. No filesystem access happens here — `workspaces.ts` owns the IO (readdir walks,
// manifest probes, realpath containment guards) and feeds this module plain values.
import { isAbsolute, posix, sep } from 'node:path';
import { PARENT_DIR_SEGMENT } from './workspaces-shapes.ts';

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
  // The declaration file is there and names workspaces, but nothing usable came out of it. The
  // pnpm reader is a line parser, not a YAML parser, so valid flow style (`packages: ["a/*"]`)
  // yields zero patterns. Without this the repo would be indistinguishable from one that
  // declares no workspaces at all — and would then look like a complete, trustworthy scan.
  | { kind: 'workspace_declaration_unparsed'; file: string }
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
  'workspace_declaration_unparsed',
  'workspace_dir_unreadable',
  'workspace_file_unreadable',
]);

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

/** Whether a scan's package list may be treated as complete FOR WHAT IT SEARCHED. An unreliable
 * scan must never be used to conclude that a configured package is gone.
 *
 * Negations no longer reach this by themselves: they are expanded and subtracted like any other
 * pattern (`workspaces.ts#expandPatterns`), so a repository that declares one still gets an exact
 * scan. Only a negation nobody can expand — one using `{a,b}`, or a doubled wildcard — lands
 * here, and it belongs here: the scan then holds directories the repository excluded, so nothing
 * in it can be shown to be a member.
 *
 * Note the qualifier: this says the declared workspaces were fully expanded, not that the whole
 * checkout was examined. `scanSearchedSomewhere` is the other half. */
const scanIsReliable = (scan: WorkspaceScan): boolean =>
  !scan.diagnostics.some((diagnostic) => UNRELIABLE_DIAGNOSTIC_KINDS.has(diagnostic.kind));

/** Whether the scan had anywhere to look at all.
 *
 * A repo with no workspace declaration produces an empty, *reliable* scan — correct as a
 * statement about workspaces, and worthless as evidence about a package. `refs add`'s npm
 * fallback registers packages in exactly such repos (`path: "."`, or the packument's
 * `directory`), and workspace detection can never see them. Concluding "gone" from a scan that
 * enumerated nothing would be a definite answer drawn from zero inspection — the failure this
 * whole mechanism exists to prevent. */
const scanSearchedSomewhere = (scan: WorkspaceScan): boolean =>
  !scan.diagnostics.some((diagnostic) => diagnostic.kind === 'no_workspace_declaration');

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
  compareCodepoint,
  deduplicateAndSort,
  isRelPathContained,
  scanIsReliable,
  scanSearchedSomewhere,
  selectPackageDirs,
  sortDiagnostics,
  toWorkspacePackage,
};
export type { PackageManifestInfo, WorkspaceDiagnostic, WorkspacePackage, WorkspaceScan };
