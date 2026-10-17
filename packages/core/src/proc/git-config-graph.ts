import type { ConfigContext, ConfigPaths } from './git-config-paths.ts';
import type { ConfigEntry, GitConfigRun } from './git-config-records.ts';
import {
  absoluteConfigPath,
  checkedConfigPath,
  configPaths,
  includePath,
} from './git-config-paths.ts';
import { assertMissingConfigPath, includePathCandidates, isMissing } from './git-config-missing.ts';
import { configFailure, parseConfigRecords } from './git-config-records.ts';

const LIST_CONFIG = ['config', '--no-includes', '--null', '--show-origin', '--list'];
const MAX_INCLUDE_DEPTH = 10;
const MAX_CONFIG_FILES = 64;
const MAX_CONFIG_ENTRIES = 4096;

type Graph = {
  run: GitConfigRun;
  paths: ConfigPaths;
  entries: ConfigEntry[];
  files: Set<string>;
};

const isInclude = (key: string): boolean =>
  key === 'include.path' || (key.startsWith('includeif.') && key.endsWith('.path'));

const recordEntries = (graph: Graph, entries: readonly ConfigEntry[]): void => {
  graph.entries.push(...entries);
  if (graph.entries.length > MAX_CONFIG_ENTRIES) {
    throw configFailure();
  }
};

const checkRootSources = async (graph: Graph, entries: readonly ConfigEntry[]): Promise<void> => {
  const origins = new Set(entries.map((entry) => entry.origin));
  for (const origin of origins) {
    if (origin.startsWith('file:')) {
      // eslint-disable-next-line no-await-in-loop -- fail closed before following any includes
      await checkedConfigPath(
        absoluteConfigPath(graph.paths.cwd, origin.slice('file:'.length)),
        graph.paths,
        true,
      );
    }
  }
};

// Visit inactive conditions too: clone, checkout and remote creation can change which branch,
// gitdir or remote-URL conditions Git selects after a preflight. Keep the original include graph
// in place for execution, preserving Git's auth/transport configuration scopes and precedence.
const visitIncludes = async (
  graph: Graph,
  entries: readonly ConfigEntry[],
  ancestors: readonly string[],
): Promise<void> => {
  for (const entry of entries.filter((candidate) => isInclude(candidate.key))) {
    // eslint-disable-next-line no-await-in-loop -- depth-first traversal detects active-path cycles
    await visitInclude(graph, entry, ancestors);
  }
};

const checkedInclude = async (path: string, paths: ConfigPaths): Promise<string | undefined> => {
  try {
    return await checkedConfigPath(path, paths, false);
  } catch (error) {
    if (!isMissing(error)) {
      throw configFailure();
    }
    await assertMissingConfigPath(path, paths);
    return undefined;
  }
};

const recordFile = (graph: Graph, path: string, ancestors: readonly string[]): void => {
  if (ancestors.includes(path) || ancestors.length >= MAX_INCLUDE_DEPTH) {
    throw configFailure();
  }
  graph.files.add(path);
  if (graph.files.size > MAX_CONFIG_FILES) {
    throw configFailure();
  }
};

const visitInclude = async (
  graph: Graph,
  entry: ConfigEntry,
  ancestors: readonly string[],
): Promise<void> => {
  const path = await includePath(graph.run, entry, graph.paths);
  for (const candidate of includePathCandidates(path, graph.paths)) {
    // eslint-disable-next-line no-await-in-loop -- rooted Windows paths may differ across drives
    await visitFile(graph, candidate, ancestors);
  }
};

const visitFile = async (
  graph: Graph,
  path: string,
  ancestors: readonly string[],
): Promise<void> => {
  const canonical = await checkedInclude(path, graph.paths);
  recordFile(graph, canonical ?? path, ancestors);
  if (canonical === undefined) {
    return;
  }
  const entries = parseConfigRecords(await graph.run([...LIST_CONFIG, '--file', path]));
  recordEntries(graph, entries);
  await visitIncludes(graph, entries, [...ancestors, canonical]);
};

/** Inventories every possible included configuration before a hook-capable operation.
 * Only provably external missing includes may be skipped; ambiguous paths, unreadable sources,
 * encodings and bounded traversal failures are refusals.
 * The caller must use a raw, nonrecursive Git runner with the same environment and cwd as the
 * eventual operation (using LC_ALL=C for inventory diagnostics), and must reject GIT_CONFIG (which changes only the config subcommand).
 * Concurrent changes by trusted host processes remain outside this read-before-execute boundary. */
const readGitConfigGraph = async (
  run: GitConfigRun,
  context: ConfigContext,
): Promise<ConfigEntry[]> => {
  try {
    const graph: Graph = {
      entries: [],
      files: new Set(),
      paths: await configPaths(run, context),
      run,
    };
    const entries = parseConfigRecords(await run(LIST_CONFIG));
    recordEntries(graph, entries);
    await checkRootSources(graph, entries);
    await visitIncludes(graph, entries, []);
    return graph.entries;
  } catch {
    throw configFailure();
  }
};

export { readGitConfigGraph };
export type { ConfigContext } from './git-config-paths.ts';
export type { ConfigEntry, GitConfigRun } from './git-config-records.ts';
