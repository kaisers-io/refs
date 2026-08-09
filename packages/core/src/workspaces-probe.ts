// Probing one candidate directory into either a package or a diagnostic. Split from
// `workspaces.ts` to keep each file focused: this one owns "what is at this path", while
// `workspaces.ts` owns pattern expansion and orchestration.
import type {
  PackageManifestInfo,
  WorkspaceDiagnostic,
  WorkspacePackage,
} from './workspaces-patterns.ts';
import { extractPackageDescription, extractPackageName } from './workspaces-parse.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveInside } from './fs-containment.ts';
import { toWorkspacePackage } from './workspaces-patterns.ts';

type ProbedDir = {
  diagnostic?: WorkspaceDiagnostic;
  pkg?: WorkspacePackage;
};

// Reads a candidate's package.json and extracts name/description. Resolution happens before the
// read, so a manifest symlinked out of the repo is refused without its contents being touched.
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
    return {
      description: extractPackageDescription(data),
      name: extractPackageName(data),
    };
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
    // The manifest read fine; it just declares no usable `name`. Not a failure to read, so it
    // gets its own kind — but still unreliable, since a real package could be hiding here.
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

export { partitionProbes, probePackageDir };
export type { ProbedDir };
