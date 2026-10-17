import type { ConfigEntry, GitConfigRun } from './git-config-records.ts';
import { assertConfigPathProvenance, fullyQualifiedWindows } from './git-config-missing.ts';
import { checkedConfigOutput, configFailure } from './git-config-records.ts';
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { lstat, realpath, stat } from 'node:fs/promises';
import { configRootCandidates } from './git-config-roots-env.ts';

const TRAILING_DELIMITER = -1;
const SINGLE_VALUE_FIELDS = 2;

type ConfigContext = { cwd: string; protectedRoots: readonly string[]; env?: NodeJS.ProcessEnv };
type ConfigPaths = {
  cwd: string;
  metadata: readonly string[];
  protectedRoots: readonly string[];
  lookupRoots?: readonly string[];
};

const absoluteConfigPath = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : `${cwd}${sep}${path}`;

const sameConfigPath = (
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean => (platform === 'win32' ? win32 : posix).relative(left, right) === '';

const isWithin = (root: string, path: string): boolean => {
  const inside = relative(root, path);
  return (
    inside === '' ||
    (!inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      inside !== '..' &&
      !isAbsolute(inside))
  );
};

const readGitPath = async (run: GitConfigRun, flag: string): Promise<string | undefined> => {
  const result = await run(['rev-parse', flag]);
  if (result.exitCode !== 0) {
    const expected = /^fatal: (?:not a git repository|this operation must be run in a work tree)/u;
    if (
      result.timedOut === true ||
      result.stdoutTruncated === true ||
      !expected.test(result.stderr)
    ) {
      throw configFailure();
    }
    return undefined;
  }
  const output = checkedConfigOutput(result);
  if (!output.endsWith('\n') || !isAbsolute(output.slice(0, TRAILING_DELIMITER))) {
    throw configFailure();
  }
  return output.slice(0, TRAILING_DELIMITER);
};

// A future clone destination need not exist. Resolve its existing ancestors so a symlinked
// parent cannot disguise a configuration source inside the future worktree.
const canonicalRoot = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw configFailure();
    }
    await rejectDanglingLink(path);
    const parent = dirname(path);
    if (parent === path) {
      throw configFailure();
    }
    return resolve(await canonicalRoot(parent), relative(parent, path));
  }
};

const rejectDanglingLink = async (path: string): Promise<void> => {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      throw configFailure();
    }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw configFailure();
    }
  }
};

const checkPotentialRoots = async (paths: ConfigPaths, env: NodeJS.ProcessEnv): Promise<void> => {
  for (const path of configRootCandidates(env)) {
    if (!isAbsolute(path) || (process.platform === 'win32' && !fullyQualifiedWindows(path))) {
      throw configFailure();
    }
    // eslint-disable-next-line no-await-in-loop -- reject mutable roots even before they exist
    await assertConfigPathProvenance(path, paths);
    // eslint-disable-next-line no-await-in-loop -- use the checked canonical target
    const canonical = await canonicalRoot(path);
    if (paths.protectedRoots.some((root) => isWithin(root, canonical))) {
      throw configFailure();
    }
  }
};

const configPaths = async (run: GitConfigRun, context: ConfigContext): Promise<ConfigPaths> => {
  const worktree = await readGitPath(run, '--show-toplevel');
  const gitdir = await readGitPath(run, '--absolute-git-dir');
  const roots = [...context.protectedRoots, ...(worktree === undefined ? [] : [worktree])];
  const paths = {
    cwd: worktree ?? gitdir ?? resolve(context.cwd),
    lookupRoots: [
      resolve(context.cwd),
      ...roots.map((path) => absoluteConfigPath(context.cwd, path)),
    ],
    metadata: gitdir === undefined ? [] : [join(gitdir, 'config'), join(gitdir, 'config.worktree')],
    protectedRoots: await Promise.all(
      roots.map((path) => canonicalRoot(absoluteConfigPath(context.cwd, path))),
    ),
  };
  await checkPotentialRoots(paths, context.env ?? process.env);
  return paths;
};

const checkedConfigPath = async (
  path: string,
  paths: ConfigPaths,
  rootSource: boolean,
): Promise<string> => {
  const canonical = await realpath(path);
  const metadata =
    rootSource &&
    paths.metadata.some((allowed) => sameConfigPath(allowed, path)) &&
    sameConfigPath(path, canonical);
  const source = await stat(canonical);
  if (
    !source.isFile() ||
    (!metadata && paths.protectedRoots.some((root) => isWithin(root, canonical)))
  ) {
    throw configFailure();
  }
  if (!metadata) {
    await assertConfigPathProvenance(path, paths);
  }
  return canonical;
};

const expandedInclude = async (run: GitConfigRun, value: string): Promise<string> => {
  const result = await run([
    '-c',
    `refs-policy.path=${value}`,
    'config',
    '--no-includes',
    '--null',
    '--type=path',
    '--get',
    'refs-policy.path',
  ]);
  const output = checkedConfigOutput(result);
  const parts = output.split('\0');
  if (
    parts.length !== SINGLE_VALUE_FIELDS ||
    parts[1] !== '' ||
    parts[0] === undefined ||
    parts[0] === ''
  ) {
    throw configFailure();
  }
  return parts[0];
};

const includePath = async (
  run: GitConfigRun,
  entry: ConfigEntry,
  paths: ConfigPaths,
): Promise<string> => {
  if (entry.value === undefined) {
    throw configFailure();
  }
  const expanded = await expandedInclude(run, entry.value);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  if (!entry.origin.startsWith('file:')) {
    throw configFailure();
  }
  const origin = absoluteConfigPath(paths.cwd, entry.origin.slice('file:'.length));
  // Preserve symlink/../ semantics: Git concatenates this path before the OS resolves it.
  return `${dirname(origin)}${sep}${expanded}`;
};

export {
  canonicalRoot,
  absoluteConfigPath,
  checkedConfigPath,
  configPaths,
  includePath,
  sameConfigPath,
};
export type { ConfigContext, ConfigPaths };
