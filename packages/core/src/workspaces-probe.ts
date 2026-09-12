// Probing one candidate directory into either a package or a diagnostic. Split from
// `workspaces.ts` to keep each file focused: this one owns "what is at this path", while
// `workspaces.ts` owns pattern expansion and orchestration.
import type {
  PackageManifestInfo,
  WorkspaceDiagnostic,
  WorkspacePackage,
} from './workspaces-patterns.ts';
import { join, posix } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { selectPackageDirs, toWorkspacePackage } from './workspaces-patterns.ts';
import { CURRENT_DIR_SEGMENT } from './workspaces-shapes.ts';
import type { Dirent } from 'node:fs';
import { extractPackageName } from './workspaces-parse.ts';
import { resolveInside } from './fs-containment.ts';

type ProbedDir = {
  diagnostic?: WorkspaceDiagnostic;
  pkg?: WorkspacePackage;
};

// Reads a candidate's package.json and extracts its name. Resolution happens before the read, so
// a manifest symlinked out of the repo is refused without its contents being touched.
const readPackageInfo = async (
  repoDir: string,
  packageDir: string,
): Promise<PackageManifestInfo | undefined> => {
  const located = await resolveInside(repoDir, join(packageDir, 'package.json'));
  if (located.kind !== 'inside') {
    return undefined;
  }
  try {
    const data = JSON.parse(await readFile(located.real, 'utf8')) as Record<string, unknown>;
    return { name: extractPackageName(data) };
  } catch {
    return undefined;
  }
};

// One candidate directory -> either a package or a diagnostic. Keeps both things the old
// `processSinglePackageDir` did: the containment guard (a textually safe path component can
// still be a symlink out of the repo) and the repo-relative/absolute argument split —
// `toWorkspacePackage` gets the repo-RELATIVE `packageDir` (it becomes the stored `path`),
// `readPackageInfo` the ABSOLUTE path.
const probePackageDir = async (repoDir: string, packageDir: string): Promise<ProbedDir> => {
  const info = await readPackageInfo(repoDir, join(repoDir, packageDir));
  if (info === undefined) {
    return { diagnostic: { kind: 'manifest_unreadable', path: packageDir } };
  }

  const pkg = toWorkspacePackage(packageDir, info);
  if (pkg === undefined) {
    // The manifest read fine; it just declares no usable `name`. Its own kind, and deliberately
    // NOT one that makes a scan unreliable: identity here is the package name, so a manifest
    // without one cannot be the package anyone asked for. Nothing is hidden by it.
    return { diagnostic: { kind: 'manifest_missing_name', path: packageDir } };
  }
  return { pkg };
};

// Split the probe results into the packages found and the reasons the rest were not.
const partitionProbes = (
  probed: readonly ProbedDir[],
): { diagnostics: WorkspaceDiagnostic[]; packages: WorkspacePackage[] } => {
  const diagnostics: WorkspaceDiagnostic[] = [];
  const packages: WorkspacePackage[] = [];
  for (const item of probed) {
    if (item.diagnostic !== undefined) {
      diagnostics.push(item.diagnostic);
    }
    if (item.pkg !== undefined) {
      packages.push(item.pkg);
    }
  }
  return { diagnostics, packages };
};

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

export {
  MISSING_DIR_CODES,
  partitionProbes,
  probeCandidateDir,
  probeChildren,
  probePackageDir,
  tryReaddir,
};
export type { ExpandResult, ProbedDir };
