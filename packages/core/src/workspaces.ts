import {
  collectPnpmPatterns,
  extractPackageDescription,
  extractPackageName,
  parseNpmWorkspaces,
} from './workspaces-parse.ts';
import { isAbsolute, join, relative, sep } from 'node:path';
import { readFile, readdir, realpath } from 'node:fs/promises';

interface WorkspacePackage {
  // Missing description is `undefined` (omitted in JSON), matching the proposal schema's
  // optional description (`zPackageEntry.partial({ description: true })` in proposal.ts).
  description: string | undefined;
  name: string;
  path: string;
}

const GLOB_SUFFIX = '/*';
const BARE_GLOB = '*';
const EMPTY_STRING = '';
const CURRENT_DIR_SEGMENT = '.';
const PARENT_DIR_SEGMENT = '..';
const PATH_SEGMENT_SEPARATOR_PATTERN = /[/\\]/u;
const ZERO = 0;
const ONE = 1;

// Reject any workspace pattern that is absolute or contains `.`/`..` path segments before
// it is ever used in a filesystem call. Defense in depth; `isContainedInRepo` still
// re-checks each resolved candidate via realpath below.
const isSafeWorkspacePattern = (pattern: string): boolean => {
  if (isAbsolute(pattern)) {
    return false;
  }

  const segments = pattern.split(PATH_SEGMENT_SEPARATOR_PATTERN);
  return segments.every(
    (segment) => segment !== CURRENT_DIR_SEGMENT && segment !== PARENT_DIR_SEGMENT,
  );
};

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
    const rel = relative(repoReal, targetReal);
    if (allowSelf && rel === EMPTY_STRING) {
      return true;
    }

    // `rel.startsWith('..')` alone is wrong: an in-repo entry literally named `..packages`
    // also starts with `..` without escaping repoReal. Only an exact `..` or a `..`
    // followed by a path separator means escape.
    const isParentOrAbove = rel === PARENT_DIR_SEGMENT || rel.startsWith(PARENT_DIR_SEGMENT + sep);

    return rel !== EMPTY_STRING && !isParentOrAbove && !isAbsolute(rel);
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
// eslint-disable-next-line max-statements -- directory traversal with async file checks, unavoidable complexity
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
    const checkPromises = entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const hasPackage = await hasPackageJson(repoDir, join(fullPath, entry.name));
        if (!hasPackage) {
          // eslint-disable-next-line unicorn/no-useless-undefined -- undefined is filtered by type guard below
          return undefined;
        }

        return join(baseDir, entry.name);
      });

    const results = await Promise.all(checkPromises);
    return results.filter((result): result is string => result !== undefined);
  } catch {
    return [];
  }
};

// Expand glob pattern (one level only)
// eslint-disable-next-line max-statements -- pattern matching with multiple glob expansion forms, unavoidable complexity
const expandGlobPattern = async (repoDir: string, pattern: string): Promise<string[]> => {
  if (!isSafeWorkspacePattern(pattern)) {
    return [];
  }

  if (pattern.startsWith('!') || pattern.includes('**')) {
    return [];
  }

  const globCount = (pattern.match(/\*/gu) ?? []).length;
  if (globCount > ONE) {
    return [];
  }

  if (pattern.endsWith(GLOB_SUFFIX)) {
    const baseDir = pattern.slice(ZERO, -GLOB_SUFFIX.length);
    return expandGlobSingleLevel(repoDir, baseDir);
  }

  // Bare `*` (a flat workspaces layout) expands the repo root as glob base, same as `<dir>/*`.
  if (pattern === BARE_GLOB) {
    return expandGlobSingleLevel(repoDir, CURRENT_DIR_SEGMENT);
  }

  if (!pattern.includes('*')) {
    const dirPath = join(repoDir, pattern);
    // Guard the file read itself: `pattern` can be a symlink resolving outside the repo.
    if ((await isContainedInRepo(repoDir, dirPath)) && (await hasPackageJson(repoDir, dirPath))) {
      return [pattern];
    }
  }

  return [];
};

// Read package.json and extract name/description; guards the manifest FILE (see `hasPackageJson`).
const readPackageInfo = async (
  repoDir: string,
  packageDir: string,
): Promise<{ description: string | undefined; name: string | undefined } | undefined> => {
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

// Deduplicate by path and sort
const deduplicateAndSort = (packages: WorkspacePackage[]): WorkspacePackage[] => {
  const mapEntries = packages.map((pkg) => [pkg.path, pkg] as const);
  const deduped = [...new Map<string, WorkspacePackage>(mapEntries).values()];
  deduped.sort((packageA, packageB) => packageA.path.localeCompare(packageB.path));
  return deduped;
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

  const info = await readPackageInfo(repoDir, fullPath);
  if (!info?.name) {
    return undefined;
  }

  return {
    description: info.description,
    name: info.name,
    path: packageDir,
  };
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

// eslint-disable-next-line max-statements, max-lines-per-function -- orchestration function reading multiple sources and coordinating async operations, unavoidable complexity
const detectWorkspacePackages = async (repoDir: string): Promise<WorkspacePackage[]> => {
  const packageJsonPath = join(repoDir, 'package.json');
  const pnpmWorkspacePath = join(repoDir, 'pnpm-workspace.yaml');

  const npmPatterns = await collectNpmPatterns(repoDir, packageJsonPath);
  const pnpmPatternsSet = await collectPnpmPatternsFromFile(repoDir, pnpmWorkspacePath);

  const patterns = new Set<string>();
  npmPatterns.forEach((pattern) => patterns.add(pattern));
  pnpmPatternsSet.forEach((pattern) => patterns.add(pattern));

  if (patterns.size === ZERO) {
    return [];
  }

  const packageDirs = await expandPatterns(repoDir, patterns);
  const packages = await processAllPackageDirs(repoDir, packageDirs);

  return deduplicateAndSort(packages);
};

export { detectWorkspacePackages };
export type { WorkspacePackage };
