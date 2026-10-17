import { dirname, isAbsolute, parse, posix, relative, resolve, sep, win32 } from 'node:path';
import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import type { ConfigPaths } from './git-config-paths.ts';
import type { Stats } from 'node:fs';
import { configFailure } from './git-config-records.ts';
import { missingProtectionRoots } from './git-path-protection.ts';

const MAX_ALIAS_DEPTH = 32;
const MAX_PATH_PROBES = 4096;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const fullyQualifiedWindows = (path: string): boolean =>
  /^[a-z]:[\\/]/iu.test(path) || /^[/\\]{2}[^/\\?.][^/\\]*[/\\][^/\\]+[/\\]/u.test(path);

// A rooted Windows path such as /github/runner_temp/config changes drive with cwd. Inspect
// every client worktree/destination drive, preserving lexical symlink/../ interpretation.
const includePathCandidates = (
  path: string,
  paths: Pick<ConfigPaths, 'cwd' | 'protectedRoots' | 'lookupRoots'>,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  if (platform !== 'win32' || fullyQualifiedWindows(path)) {
    return [path];
  }
  const roots = new Set(
    [paths.cwd, ...paths.protectedRoots, ...(paths.lookupRoots ?? [])].map(
      (entry) => win32.parse(entry).root,
    ),
  );
  if (!/^[/\\][^/\\]/u.test(path) || [...roots].some((root) => !fullyQualifiedWindows(root))) {
    throw configFailure();
  }
  return [...roots].map((root) => `${root}${path.replace(/^[/\\]+/u, '')}`);
};

const missingPathCandidates = (
  path: string,
  paths: Pick<ConfigPaths, 'cwd' | 'protectedRoots' | 'lookupRoots'>,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  const native = platform === 'win32' ? win32 : posix;
  const components = path.split(platform === 'win32' ? /[/\\]/u : '/');
  if (!native.isAbsolute(path) || components.some((part) => part === '.' || part === '..')) {
    throw configFailure();
  }
  return includePathCandidates(path, paths, platform).map((candidate) => native.resolve(candidate));
};

const insideRoot = (root: string, path: string): boolean => {
  const suffix = relative(root, path);
  return (
    suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  );
};

const assertExternal = (path: string, paths: ConfigPaths): void => {
  if (paths.protectedRoots.some((root) => insideRoot(root, path))) {
    throw configFailure();
  }
};

type Inspection = {
  candidate: string;
  paths: ConfigPaths;
  depth: number;
  missing: boolean;
  budget: { remaining: number };
  aliases: Set<string>;
};

type PrefixInspection = Inspection & { requireDirectory: boolean };

const existingEntry = async (path: string): Promise<Stats | undefined> => {
  try {
    return await lstat(path);
  } catch (error) {
    if (!isMissing(error)) {
      throw configFailure();
    }
    return undefined;
  }
};

const checkAlias = async (path: string, context: Inspection): Promise<void> => {
  if (context.aliases.has(path)) {
    return;
  }
  if (context.depth >= MAX_ALIAS_DEPTH) {
    throw configFailure();
  }
  const link = await readlink(path);
  const target = isAbsolute(link) ? link : `${dirname(path)}${sep}${link}`;
  for (const candidate of includePathCandidates(target, context.paths)) {
    // eslint-disable-next-line no-await-in-loop -- inspect every intermediate alias target
    await inspectPath({ ...context, candidate, depth: context.depth + 1, missing: false });
  }
  context.aliases.add(path);
};

const checkPrefix = async (path: string, context: PrefixInspection): Promise<void> => {
  context.budget.remaining -= 1;
  if (context.budget.remaining < 0) {
    throw configFailure();
  }
  assertExternal(path, context.paths);
  const entry = await existingEntry(path);
  if (entry === undefined) {
    if (!context.missing) {
      throw configFailure();
    }
    return;
  }
  await checkExistingPrefix(path, context, entry);
};

const directoryEntry = async (path: string, entry: Stats): Promise<boolean> => {
  const target = entry.isSymbolicLink() ? await stat(path) : entry;
  return target.isDirectory();
};

const checkExistingPrefix = async (
  path: string,
  context: PrefixInspection,
  entry: Stats,
): Promise<void> => {
  // An existing but dangling symlink must fail, even when the final include is absent.
  const canonical = await realpath(path);
  assertExternal(canonical, context.paths);
  // Windows reports ENOENT for file/child too. A missing lookup still requires directory
  // ancestors; checking the error code alone would mistake a non-directory for an absent file.
  if (context.requireDirectory && !(await directoryEntry(canonical, entry))) {
    throw configFailure();
  }
  if (context.missing) {
    assertExternal(resolve(canonical, relative(path, context.candidate)), context.paths);
  }
  if (entry.isSymbolicLink()) {
    await checkAlias(path, context);
  }
};

const pathPrefixes = (path: string): string[] => {
  const { root } = parse(path);
  const components = path.slice(root.length).split(process.platform === 'win32' ? /[/\\]/u : '/');
  const result = [root];
  let prefix = root;
  for (const component of components.filter((part) => part !== '')) {
    prefix = `${prefix}${sep}${component}`;
    result.push(prefix);
  }
  return result;
};

// Preserve dot components for existing paths so native Git/OS lookup semantics remain intact.
const inspectPath = async (context: Inspection): Promise<void> => {
  assertExternal(context.candidate, context.paths);
  const prefixes = pathPrefixes(context.candidate);
  for (const [index, prefix] of prefixes.entries()) {
    // eslint-disable-next-line no-await-in-loop -- inspect every prefix before following the next
    await checkPrefix(prefix, { ...context, requireDirectory: index < prefixes.length - 1 });
  }
};

const inspectCandidates = async (
  paths: ConfigPaths,
  candidates: string[],
  missing: boolean,
): Promise<void> => {
  const budget = { remaining: MAX_PATH_PROBES };
  const aliases = new Set<string>();
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- every client drive/share interpretation must pass
    await inspectPath({ aliases, budget, candidate, depth: 0, missing, paths });
  }
};

// A missing path may be ignored only when checkout cannot create or redirect it. Existing trusted
// aliases (such as macOS /var) remain usable; their intermediate targets are checked too.
const assertMissingConfigPath = async (path: string, paths: ConfigPaths): Promise<void> => {
  const protectedRoots = await missingProtectionRoots(paths.protectedRoots);
  await inspectCandidates({ ...paths, protectedRoots }, missingPathCandidates(path, paths), true);
};

const assertConfigPathProvenance = async (path: string, paths: ConfigPaths): Promise<void> => {
  try {
    await realpath(path);
  } catch (error) {
    if (!isMissing(error)) {
      throw configFailure();
    }
    await assertMissingConfigPath(path, paths);
    return;
  }
  await inspectCandidates(paths, includePathCandidates(path, paths), false);
};

export {
  assertConfigPathProvenance,
  assertMissingConfigPath,
  fullyQualifiedWindows,
  includePathCandidates,
  isMissing,
  missingPathCandidates,
};
