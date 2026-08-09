// IO orchestration for workspace package detection: readdir walks, package.json probes, and
// realpath containment guards. The pure decision logic (pattern classification, containment
// decisions, candidate selection, result shaping) lives in `workspaces-patterns.ts`.
import {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  deduplicateAndSort,
  isRelPathContained,
  selectPackageDirs,
  sortDiagnostics,
} from './workspaces-patterns.ts';
import type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
import { join, posix, relative } from 'node:path';
import { partitionProbes, probePackageDir } from './workspaces-probe.ts';
import { readFile, readdir, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { readDeclarations } from './workspaces-declarations.ts';
import { resolveInside } from './fs-containment.ts';

// One pattern's expansion: the candidate dirs it produced and any reason it produced fewer.
type ExpandResult = {
  diagnostics: WorkspaceDiagnostic[];
  dirs: string[];
};

// A base directory the pattern names but that is not there is normal, not a failure.
const MISSING_DIR_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

// Check if target is contained within repoDir: gates a directory read before it happens
// (a textually-safe path component can still be a symlink pointing outside the repo) and,
// as defense in depth, the final resolved package candidate. `allowSelf` lets `targetPath`
// equal repoDir itself (empty relative path); every OTHER caller keeps rejecting that —
// only the bare `*` glob base passes `true`. Residual TOCTOU: check-then-read is not
// atomic; acceptable for a local CLI not expected to be concurrently mutated by an adversary.
const isContainedInRepo = async (
  repoDir: string,
  targetPath: string,
  allowSelf = false,
): Promise<boolean> => {
  try {
    const repoReal = await realpath(repoDir);
    const targetReal = await realpath(targetPath);
    return isRelPathContained(relative(repoReal, targetReal), allowSelf);
  } catch {
    return false;
  }
};

// Check if package.json exists in directory. Guards the manifest FILE itself: a
// textually-safe, already-contained directory can still hold a symlinked package.json.
const hasPackageJson = async (repoDir: string, dirPath: string): Promise<boolean> =>
  (await probeCandidateDir(repoDir, dirPath)) === 'manifest';

// Three outcomes for one candidate directory, because the caller has to tell them apart:
//   'manifest'  — a readable package.json is there; this is a package candidate
//   'none'      — no manifest here; not a package, and nothing worth reporting
//   'rejected'  — the manifest resolves outside the repo, or could not be read at all
// The old boolean collapsed the last two, which is why a symlinked-out candidate used to vanish
// silently instead of marking the scan incomplete.
const probeCandidateDir = async (
  repoDir: string,
  dirPath: string,
): Promise<'manifest' | 'none' | 'rejected'> => {
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
const probeChildren = async (opts: {
  baseDir: string;
  dirs: readonly Dirent[];
  fullPath: string;
  repoDir: string;
}): Promise<ExpandResult> => {
  const { baseDir, dirs, fullPath, repoDir } = opts;
  const probes = await Promise.all(
    dirs.map((entry) => probeCandidateDir(repoDir, join(fullPath, entry.name))),
  );
  const diagnostics = dirs
    .map((entry, index) => ({ name: entry.name, probe: probes[index] }))
    .filter((item) => item.probe === 'rejected')
    .map((item): WorkspaceDiagnostic => ({
      kind: 'manifest_unreadable',
      path: posix.join(baseDir === CURRENT_DIR_SEGMENT ? '' : baseDir, item.name),
    }));
  return {
    diagnostics,
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
  // `resolveInside`, not `isContainedInRepo`: the boolean helper returns false for a base
  // directory that merely does not exist yet, which would report `packages/*` in a repo without
  // a `packages/` directory as a failure — the single most common workspace layout in a young
  // repo. Only `outside` and `unreadable` are real problems here.
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
  });
};

// Expand one glob pattern. Which form the pattern takes is decided purely in
// `classifyWorkspacePattern`; only the plan's filesystem side runs here. An ignored pattern is
// reported: a package could be hiding behind it, so the scan is not complete.
const expandGlobPattern = async (repoDir: string, pattern: string): Promise<ExpandResult> => {
  const plan = classifyWorkspacePattern(pattern);
  if (plan.kind === 'expand-children') {
    return expandGlobSingleLevel(repoDir, plan.baseDir);
  }

  if (plan.kind === 'probe-dir') {
    const dirPath = join(repoDir, plan.dir);
    // Guard the file read itself: `pattern` can be a symlink resolving outside the repo.
    if ((await isContainedInRepo(repoDir, dirPath)) && (await hasPackageJson(repoDir, dirPath))) {
      return { diagnostics: [], dirs: [plan.dir] };
    }
    return { diagnostics: [], dirs: [] };
  }

  return { diagnostics: [{ kind: 'unsupported_pattern', pattern }], dirs: [] };
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

const detectWorkspacePackagesDetailed = async (repoDir: string): Promise<WorkspaceScan> => {
  const declared = await readDeclarations(repoDir);
  if (declared.patterns.size === 0) {
    return {
      diagnostics: sortDiagnostics([...declared.diagnostics, { kind: 'no_workspace_declaration' }]),
      packages: [],
    };
  }

  const expansion = await expandPatterns(repoDir, declared.patterns);
  const probed = await Promise.all(expansion.dirs.map((dir) => probePackageDir(repoDir, dir)));
  const partitioned = partitionProbes(probed);

  return {
    diagnostics: sortDiagnostics([
      ...declared.diagnostics,
      ...expansion.diagnostics,
      ...partitioned.diagnostics,
    ]),
    packages: deduplicateAndSort(partitioned.packages),
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
export { scanIsReliable } from './workspaces-patterns.ts';
export type {
  WorkspaceDiagnostic,
  WorkspacePackage,
  WorkspaceScan,
} from './workspaces-patterns.ts';
