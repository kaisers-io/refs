// IO orchestration for workspace package detection: readdir walks, package.json probes, and
// realpath containment guards. The pure decision logic (pattern classification, containment
// decisions, candidate selection, result shaping) lives in `workspaces-patterns.ts`.
import {
  CURRENT_DIR_SEGMENT,
  classifyWorkspacePattern,
  deduplicateAndSort,
  isRelPathContained,
  selectPackageDirs,
  toWorkspacePackage,
} from './workspaces-patterns.ts';
import type { PackageManifestInfo, WorkspacePackage } from './workspaces-patterns.ts';
import {
  collectPnpmPatterns,
  extractPackageDescription,
  extractPackageName,
  parseNpmWorkspaces,
} from './workspaces-parse.ts';
import { join, relative } from 'node:path';
import { readFile, readdir, realpath } from 'node:fs/promises';

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
const hasPackageJson = async (repoDir: string, dirPath: string): Promise<boolean> => {
  try {
    const pkgJsonPath = join(dirPath, 'package.json');
    if (!(await isContainedInRepo(repoDir, pkgJsonPath))) {
      return false;
    }

    await readFile(pkgJsonPath, 'utf8');
    return true;
  } catch {
    return false;
  }
};

// Handle one-level glob pattern expansion
const expandGlobSingleLevel = async (repoDir: string, baseDir: string): Promise<string[]> => {
  try {
    const fullPath = join(repoDir, baseDir);
    // Guard the directory read itself: `baseDir` can be a symlink outside the repo.
    // `allowSelf` covers bare `*` (`baseDir === '.'`), where `fullPath` is repoDir itself.
    const isRepoRoot = baseDir === CURRENT_DIR_SEGMENT;
    if (!(await isContainedInRepo(repoDir, fullPath, isRepoRoot))) {
      return [];
    }

    const entries = await readdir(fullPath, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());
    const hasPackageFlags = await Promise.all(
      dirs.map((entry) => hasPackageJson(repoDir, join(fullPath, entry.name))),
    );
    return selectPackageDirs(
      baseDir,
      dirs.map((entry) => entry.name),
      hasPackageFlags,
    );
  } catch {
    return [];
  }
};

// Expand glob pattern (one level only). Which form the pattern takes is decided purely in
// `classifyWorkspacePattern`; only the plan's filesystem side runs here.
const expandGlobPattern = async (repoDir: string, pattern: string): Promise<string[]> => {
  const plan = classifyWorkspacePattern(pattern);
  if (plan.kind === 'expand-children') {
    return expandGlobSingleLevel(repoDir, plan.baseDir);
  }

  if (plan.kind === 'probe-dir') {
    const dirPath = join(repoDir, plan.dir);
    // Guard the file read itself: `pattern` can be a symlink resolving outside the repo.
    if ((await isContainedInRepo(repoDir, dirPath)) && (await hasPackageJson(repoDir, dirPath))) {
      return [plan.dir];
    }
  }

  return [];
};

// Read package.json and extract name/description; guards the manifest FILE (see `hasPackageJson`).
const readPackageInfo = async (
  repoDir: string,
  packageDir: string,
): Promise<PackageManifestInfo | undefined> => {
  try {
    const pkgJsonPath = join(packageDir, 'package.json');
    if (!(await isContainedInRepo(repoDir, pkgJsonPath))) {
      return undefined;
    }

    const content = await readFile(pkgJsonPath, 'utf8');
    const data = JSON.parse(content) as Record<string, unknown>;

    return {
      description: extractPackageDescription(data),
      name: extractPackageName(data),
    };
  } catch {
    return undefined;
  }
};

// Collect npm workspace patterns; guards the manifest FILE itself (see `hasPackageJson`)
// since the root `package.json` path, built from `repoDir`, can still be a symlink escape.
const collectNpmPatterns = async (
  repoDir: string,
  packageJsonPath: string,
): Promise<Set<string>> => {
  const patterns = new Set<string>();
  try {
    if (!(await isContainedInRepo(repoDir, packageJsonPath))) {
      return patterns;
    }

    const npmContent = await readFile(packageJsonPath, 'utf8');
    const npmData = JSON.parse(npmContent) as Record<string, unknown>;
    parseNpmWorkspaces(npmData['workspaces']).forEach((pattern) => patterns.add(pattern));
  } catch {
    // Continue if npm workspaces not found
  }

  return patterns;
};

// Collect pnpm workspace patterns; guards the manifest FILE itself since the root
// `pnpm-workspace.yaml` path, built from `repoDir`, can still be a symlink escape.
const collectPnpmPatternsFromFile = async (
  repoDir: string,
  pnpmWorkspacePath: string,
): Promise<Set<string>> => {
  const patterns = new Set<string>();
  try {
    if (!(await isContainedInRepo(repoDir, pnpmWorkspacePath))) {
      return patterns;
    }

    const pnpmContent = await readFile(pnpmWorkspacePath, 'utf8');
    collectPnpmPatterns(pnpmContent.split('\n')).forEach((pattern) => patterns.add(pattern));
  } catch {
    // Continue if pnpm workspaces not found
  }

  return patterns;
};

// Expand patterns to get package directories
const expandPatterns = async (repoDir: string, patterns: Set<string>): Promise<Set<string>> => {
  const packageDirs = new Set<string>();
  const expandPromises = [...patterns].map((pattern) => expandGlobPattern(repoDir, pattern));
  const expandedResults = await Promise.all(expandPromises);
  expandedResults.forEach((expanded) => {
    expanded.forEach((dir) => packageDirs.add(dir));
  });

  return packageDirs;
};

// Process single package directory
const processSinglePackageDir = async (
  repoDir: string,
  packageDir: string,
): Promise<WorkspacePackage | undefined> => {
  const fullPath = join(repoDir, packageDir);
  if (!(await isContainedInRepo(repoDir, fullPath))) {
    return undefined;
  }

  return toWorkspacePackage(packageDir, await readPackageInfo(repoDir, fullPath));
};

// Process all package directories
const processAllPackageDirs = async (
  repoDir: string,
  packageDirs: Set<string>,
): Promise<WorkspacePackage[]> => {
  const processPromises = [...packageDirs].map((packageDir) =>
    processSinglePackageDir(repoDir, packageDir),
  );
  const results = await Promise.all(processPromises);

  return results.filter((pkg): pkg is WorkspacePackage => pkg !== undefined);
};

const detectWorkspacePackages = async (repoDir: string): Promise<WorkspacePackage[]> => {
  const packageJsonPath = join(repoDir, 'package.json');
  const pnpmWorkspacePath = join(repoDir, 'pnpm-workspace.yaml');

  const npmPatterns = await collectNpmPatterns(repoDir, packageJsonPath);
  const pnpmPatternsSet = await collectPnpmPatternsFromFile(repoDir, pnpmWorkspacePath);

  const patterns = new Set<string>([...npmPatterns, ...pnpmPatternsSet]);

  if (patterns.size === 0) {
    return [];
  }

  const packageDirs = await expandPatterns(repoDir, patterns);
  const packages = await processAllPackageDirs(repoDir, packageDirs);

  return deduplicateAndSort(packages);
};

export { detectWorkspacePackages };
export type { WorkspacePackage } from './workspaces-patterns.ts';
