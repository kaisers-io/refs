// IO orchestration for workspace package detection: readdir walks, package.json probes, and
// realpath containment guards. The pure decision logic (pattern classification, containment
// decisions, candidate selection, result shaping) lives in `workspaces-patterns.ts`.
import {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  deduplicateAndSort,
  selectPackageDirs,
  sortDiagnostics,
} from './workspaces-patterns.ts';
import type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
import { join, posix } from 'node:path';
import { partitionProbes, probePackageDir } from './workspaces-probe.ts';
import { readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import type { ProbedDir } from './workspaces-probe.ts';
import { readDeclarations } from './workspaces-declarations.ts';
import { resolveInside } from './fs-containment.ts';

// One pattern's expansion: the candidate dirs it produced and any reason it produced fewer.
type ExpandResult = {
  diagnostics: WorkspaceDiagnostic[];
  dirs: string[];
};

// A base directory the pattern names but that is not there is normal, not a failure.
const MISSING_DIR_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

// Three outcomes for one candidate directory, because the caller has to tell them apart:
//   'manifest'  — a readable package.json is there; this is a package candidate
//   'none'      — no manifest here; not a package, and nothing worth reporting
//   'rejected'  — the manifest resolves outside the repo, or could not be read at all
// The old boolean collapsed the last two, which is why a symlinked-out candidate used to vanish
// silently instead of marking the scan incomplete.
type CandidateProbe = 'manifest' | 'none' | 'rejected';

const probeCandidateDir = async (repoDir: string, dirPath: string): Promise<CandidateProbe> => {
  const located = await resolveInside(repoDir, join(dirPath, 'package.json'));
  if (located.kind === 'missing') {
    return 'none';
  }
  if (located.kind !== 'inside') {
    return 'rejected';
  }
  try {
    await readFile(located.real, 'utf8');
    return 'manifest';
  } catch {
    return 'rejected';
  }
};

// `readdir` as a result rather than an exception, so the caller can classify the failure code
// instead of catching blind.
const tryReaddir = async (path: string): Promise<{ code: string } | { entries: Dirent[] }> => {
  try {
    return { entries: await readdir(path, { withFileTypes: true }) };
  } catch (error) {
    return { code: (error as NodeJS.ErrnoException).code ?? '' };
  }
};

// Probe every child directory of an expanded glob base and split the outcome. A candidate
// rejected for containment IS reported — it is a directory the pattern selected that we refused
// to look inside, so the scan may be missing a package. A candidate that simply holds no
// manifest is not a package at all and reports nothing.
const probeAll = (
  repoDir: string,
  fullPath: string,
  entries: readonly Dirent[],
): Promise<CandidateProbe[]> =>
  Promise.all(entries.map((entry) => probeCandidateDir(repoDir, join(fullPath, entry.name))));

// The entry names whose probe result satisfies `keep`, in input order.
const pick = (
  entries: readonly Dirent[],
  probes: readonly CandidateProbe[],
  keep: (probe: CandidateProbe | undefined) => boolean,
): string[] => entries.filter((_entry, index) => keep(probes[index])).map((entry) => entry.name);

const probeChildren = async (opts: {
  baseDir: string;
  dirs: readonly Dirent[];
  fullPath: string;
  repoDir: string;
  symlinks: readonly Dirent[];
}): Promise<ExpandResult> => {
  const { baseDir, dirs, fullPath, repoDir, symlinks } = opts;
  const relPath = (name: string): string =>
    posix.join(baseDir === CURRENT_DIR_SEGMENT ? '' : baseDir, name);

  const [probes, linkProbes] = await Promise.all([
    probeAll(repoDir, fullPath, dirs),
    probeAll(repoDir, fullPath, symlinks),
  ]);

  return {
    diagnostics: [
      ...pick(dirs, probes, (probe) => probe === 'rejected').map((name): WorkspaceDiagnostic => ({
        kind: 'manifest_unreadable',
        path: relPath(name),
      })),
      // Symlinked entries never become candidates (see the caller). Only the ones that WOULD
      // have been a package are reported: a symlink to something without a manifest is not a
      // missed package and stays silent, so incidental links never make a scan unreliable.
      ...pick(symlinks, linkProbes, (probe) => probe !== 'none').map(
        (name): WorkspaceDiagnostic => ({ kind: 'candidate_not_inspected', path: relPath(name) }),
      ),
    ],
    dirs: selectPackageDirs(
      baseDir,
      dirs.map((entry) => entry.name),
      probes.map((probe) => probe === 'manifest'),
    ),
  };
};

// One-level glob expansion. Reports the two ways it can come up empty for a reason — a base
// directory that resolves outside the repo, and one that exists but cannot be read — instead of
// letting both look like "no packages here". A base directory the pattern merely names but that
// does not exist is normal (`packages/*` before `packages/` is created) and reports nothing.
const expandGlobSingleLevel = async (repoDir: string, baseDir: string): Promise<ExpandResult> => {
  const fullPath = join(repoDir, baseDir);
  // `resolveInside` answers with missing/outside/unreadable rather than a bare boolean. A
  // boolean cannot tell "this directory does not exist yet" from "I refused to look", and
  // reporting the first as a failure would mark `packages/*` unreliable in every repo that has
  // not created `packages/` yet. Only `outside` and `unreadable` are real problems here.
  const located = await resolveInside(repoDir, fullPath);
  if (located.kind === 'missing') {
    return { diagnostics: [], dirs: [] };
  }
  if (located.kind !== 'inside') {
    return { diagnostics: [{ kind: 'workspace_dir_unreadable', path: baseDir }], dirs: [] };
  }
  // The bare `*` pattern resolves to the repo root itself, which `isInside` accepts; every other
  // base dir is genuinely below it. No separate allowSelf handling is needed.

  const listed = await tryReaddir(fullPath);
  if ('code' in listed) {
    // The rejection already carries `code` — no extra `stat` needed, and an extra stat would
    // only add a race. A base directory that is not there is normal; anything else is not.
    return MISSING_DIR_CODES.has(listed.code)
      ? { diagnostics: [], dirs: [] }
      : { diagnostics: [{ kind: 'workspace_dir_unreadable', path: baseDir }], dirs: [] };
  }

  return probeChildren({
    baseDir,
    dirs: listed.entries.filter((entry) => entry.isDirectory()),
    fullPath,
    repoDir,
    // `readdir` uses lstat semantics, so a symlinked directory is not `isDirectory()` and never
    // becomes a candidate — it is invisible to detection, inside or outside the repo alike. That
    // was harmless while the scan only fed `add`'s best-effort proposal; now that callers infer
    // "gone" and "uniquely relocated" from it, an uninspected candidate has to be admitted.
    symlinks: listed.entries.filter((entry) => entry.isSymbolicLink()),
  });
};

// Expand one glob pattern. Which form the pattern takes is decided purely in
// `classifyWorkspacePattern`; only the plan's filesystem side runs here. An ignored pattern is
// reported: a package could be hiding behind it, so the scan is not complete.
const expandGlobPattern = (repoDir: string, pattern: string): Promise<ExpandResult> => {
  const plan = classifyWorkspacePattern(pattern);
  if (plan.kind === 'expand-children') {
    return expandGlobSingleLevel(repoDir, plan.baseDir);
  }

  if (plan.kind === 'probe-dir') {
    return expandLiteralDir(repoDir, plan.dir);
  }

  return Promise.resolve({ diagnostics: [{ kind: 'unsupported_pattern', pattern }], dirs: [] });
};

// A wildcard-free pattern names one directory. Same three-way probe the glob branch uses: the
// old boolean pair collapsed "no package here" (normal) with "refused to look" (a hole in the
// scan), so a literal pattern naming an unreadable directory — or one symlinked out of the repo
// — used to leave the scan looking complete.
const expandLiteralDir = async (repoDir: string, dir: string): Promise<ExpandResult> => {
  const probe = await probeCandidateDir(repoDir, join(repoDir, dir));
  if (probe === 'manifest') {
    return { diagnostics: [], dirs: [dir] };
  }
  if (probe === 'rejected') {
    return { diagnostics: [{ kind: 'manifest_unreadable', path: dir }], dirs: [] };
  }
  return { diagnostics: [], dirs: [] };
};

// Expand every pattern, merging dirs (deduplicated) and concatenating diagnostics.
const expandPatterns = async (repoDir: string, patterns: Set<string>): Promise<ExpandResult> => {
  const expanded = await Promise.all(
    [...patterns].map((pattern) => expandGlobPattern(repoDir, pattern)),
  );
  const dirs = new Set<string>();
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const result of expanded) {
    result.dirs.forEach((dir) => dirs.add(dir));
    diagnostics.push(...result.diagnostics);
  }
  return { diagnostics, dirs: [...dirs] };
};

/** The repository's own root manifest, when it declares a name.
 *
 * A workspace root is not one of its own glob targets, so expansion never reaches it — and a root
 * that names itself is then registered nowhere, which is why resolving a monorepo by the name in
 * its own `package.json` used to come back empty (#88). Both pnpm and Yarn address the root by
 * that name (`pnpm --filter <root-name>`, `yarn workspace <root-name>`); npm and Turborepo use a
 * positional handle instead. Registering it costs nothing where the name is a throwaway — nobody
 * resolves `"root"` or `"monorepo-root"` — and answers the question where it is not.
 *
 * Deliberately its own probe rather than a `.` pattern smuggled into the expansion: no declaration
 * selected the root, and pretending one did would misreport what the repo actually declares.
 *
 * Contributes a package or nothing — never a diagnostic. A diagnostic here would say "a candidate
 * could not be inspected", and there is no candidate: nothing declared the root, this probe went
 * looking on its own. A root that names nothing is the ordinary case (most workspace roots are
 * private and carry `root` or no name at all), and reporting it on every scan of every repository
 * would bury the diagnostics that do mean something. */
const probeRootPackage = async (repoDir: string): Promise<ProbedDir[]> => {
  const probed = await probePackageDir(repoDir, CURRENT_DIR_SEGMENT);
  return 'pkg' in probed ? [probed] : [];
};

/** The root, dropped when a workspace member already claims its name — the member wins.
 *
 * Applied here rather than at any one consumer, because every consumer has to agree: `refs add`
 * must not silently keep whichever entry came last, and relocation must still find a member that
 * MOVED — against a scan holding both, that lookup returns `ambiguous` and leaves `resolve` with
 * no path for a package that is plainly there. The member wins because it is the more specific
 * thing, and because it is what was registered before roots were looked at at all. */
const withoutClaimedRoot = (packages: readonly WorkspacePackage[]): WorkspacePackage[] => {
  const root = packages.find((pkg) => pkg.path === CURRENT_DIR_SEGMENT);
  if (root === undefined) {
    return [...packages];
  }
  const claimed = packages.some(
    (pkg) => pkg.path !== CURRENT_DIR_SEGMENT && pkg.name === root.name,
  );
  return claimed ? packages.filter((pkg) => pkg !== root) : [...packages];
};

const detectWorkspacePackagesDetailed = async (repoDir: string): Promise<WorkspaceScan> => {
  const declared = await readDeclarations(repoDir);
  if (declared.patterns.size === 0) {
    // No workspaces declared: an ordinary single-package repo, whose empty scan is the correct
    // answer and whose `no_workspace_declaration` diagnostic is what stops a caller concluding
    // anything from it. The root is deliberately NOT probed here — `refs add`'s npm fallback owns
    // this shape, registering the package at the packument's directory or `.`, and a root probe
    // would suppress that fallback with a locator it did not choose.
    return {
      diagnostics: sortDiagnostics([...declared.diagnostics, { kind: 'no_workspace_declaration' }]),
      packages: [],
    };
  }

  const expansion = await expandPatterns(repoDir, declared.patterns);
  const [root, expanded] = await Promise.all([
    probeRootPackage(repoDir),
    Promise.all(expansion.dirs.map((dir) => probePackageDir(repoDir, dir))),
  ]);
  const partitioned = partitionProbes([...root, ...expanded]);

  return {
    diagnostics: sortDiagnostics([
      ...declared.diagnostics,
      ...expansion.diagnostics,
      ...partitioned.diagnostics,
    ]),
    packages: withoutClaimedRoot(deduplicateAndSort(partitioned.packages)),
  };
};

/** Best-effort detection, unchanged: the exact shape `refs add` has always consumed.
 * Diagnostics are deliberately dropped here — `add` is best-effort by design and has an agent to
 * fill any gaps. */
const detectWorkspacePackages = async (repoDir: string): Promise<WorkspacePackage[]> => {
  const scan = await detectWorkspacePackagesDetailed(repoDir);
  return scan.packages;
};

export { detectWorkspacePackages, detectWorkspacePackagesDetailed };
// Re-exported here rather than from `workspaces-patterns.ts` directly: a consumer that gets a
// scan from this module needs the predicate that says whether it may be trusted, and the two
// belong together in the public surface.
export { scanIsReliable, scanSearchedSomewhere } from './workspaces-patterns.ts';
export type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
