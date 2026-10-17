import type { RunResult, Runner } from './runner.ts';
import { assertGitHelpers, assertGitSearchPaths } from './git-helper-policy.ts';
import { dirname, join, resolve } from 'node:path';
import type { ConfigEntry } from './git-config-graph.ts';
import { gitEnvironment } from './git-environment.ts';
import { gitPolicyEnvironment } from './git-policy-env.ts';
import { readGitConfigGraph } from './git-config-graph.ts';
import { resolveGitExecutable } from './git-executable.ts';

// Git <=2.35.1 interprets "false" as an executable pathname. Empty disables fsmonitor across
// the tested versions. No auto-maintenance or submodule recursion is needed to read references.
const STATIC_SETTINGS = [
  'core.fsmonitor=',
  'gc.auto=0',
  'maintenance.auto=false',
  'submodule.recurse=false',
  'fetch.recurseSubmodules=false',
];
const HOOK_COMMAND = /^hook\.(?<label>.*)\.command$/su;
const FILTER_COMMAND = /^filter\.(?<label>.*)\.(?:clean|smudge|process)$/su;
const REMOTE_EXECUTION = /^remote\..*\.(?:uploadpack|vcs)$/su;
const UNSUPPORTED_EXECUTION = new Set(['core.alternaterefscommand', 'uploadpack.packobjectshook']);
const LAST_ARGUMENT = -1;
const MAX_OVERRIDE_LENGTH = 8192;
const VALUE_NAMES = new Map([
  ['', 'REFS_GIT_POLICY_EMPTY'],
  ['false', 'REFS_GIT_POLICY_FALSE'],
  ['true', 'REFS_GIT_POLICY_TRUE'],
]);

type GitPolicyContext = { args: readonly string[]; cwd?: string; hooksPath?: string };
type PreparedGit = { args: readonly string[]; env: NodeJS.ProcessEnv };
type ReadGit = (args: readonly string[]) => Promise<RunResult>;

// Git's -c splits at the FIRST equals sign, but --config-env splits at the LAST one. Subsection
// names may contain '='; never let one turn an intended override into a different config key.
const settingArguments = (key: string, value: string): string[] =>
  key.includes('=')
    ? [`--config-env=${key}=${VALUE_NAMES.get(value) ?? 'REFS_GIT_POLICY_EMPTY'}`]
    : ['-c', `${key}=${value}`];

const labels = (entries: readonly ConfigEntry[], pattern: RegExp): Set<string> =>
  new Set(
    entries.flatMap(({ key }) => {
      const label = pattern.exec(key)?.groups?.['label'];
      return label === undefined ? [] : [label];
    }),
  );

const assertSupportedExecution = (entries: readonly ConfigEntry[]): void => {
  if (
    entries.some(
      ({ key, value }) =>
        UNSUPPORTED_EXECUTION.has(key) ||
        REMOTE_EXECUTION.test(key) ||
        (key === 'core.unsetenvvars' && value !== '' && value !== 'PERL5LIB'),
    )
  ) {
    throw new Error(
      'Git configuration defines unsupported upload-pack, alternate-refs, remote-helper or environment stripping settings; ' +
        'use a separate trusted Git configuration for refs',
    );
  }
};

const filterArguments = (label: string): string[] => {
  const args = ['clean', 'smudge', 'process'].flatMap((kind) =>
    settingArguments(`filter.${label}.${kind}`, ''),
  );
  args.push(...settingArguments(`filter.${label}.required`, 'true'));
  return args;
};

const labelArguments = (entries: readonly ConfigEntry[]): string[] => {
  const hooks = [...labels(entries, HOOK_COMMAND)].flatMap((label) =>
    settingArguments(`hook.${label}.enabled`, 'false'),
  );
  const filters = [...labels(entries, FILTER_COMMAND)].flatMap((label) => filterArguments(label));
  const args = [...hooks, ...filters];
  if (args.join(' ').length > MAX_OVERRIDE_LENGTH) {
    throw new Error('Git execution configuration is too large to neutralize safely');
  }
  return args;
};

const protectedRoots = (ctx: GitPolicyContext): string[] => {
  const sources = ctx.hooksPath === undefined ? [] : [join(dirname(ctx.hooksPath), 'sources')];
  const destination = ctx.args[0] === 'clone' ? ctx.args.at(LAST_ARGUMENT) : undefined;
  return destination === undefined ? sources : [...sources, resolve(ctx.cwd ?? '.', destination)];
};

const gitArguments = (args: readonly string[], hooksPath?: string): readonly string[] => {
  const hooks = hooksPath === undefined ? [] : ['-c', `core.hooksPath=${hooksPath}`];
  return [...STATIC_SETTINGS.flatMap((setting) => ['-c', setting]), ...hooks, ...args];
};

const prepareGitCommand = async (run: ReadGit, ctx: GitPolicyContext): Promise<PreparedGit> => {
  const entries = await readGitConfigGraph(run, {
    cwd: ctx.cwd ?? process.cwd(),
    env: gitEnvironment(process.env),
    protectedRoots: protectedRoots(ctx),
  });
  assertSupportedExecution(entries);
  await assertGitHelpers(entries, { env: gitEnvironment(process.env), roots: protectedRoots(ctx) });
  return {
    args: [...labelArguments(entries), ...gitArguments(ctx.args, ctx.hooksPath)],
    env: gitPolicyEnvironment(process.env),
  };
};

const assertGitEnvironment = async (ctx: GitPolicyContext): Promise<string> => {
  const context = { env: gitEnvironment(process.env), roots: protectedRoots(ctx) };
  await assertGitSearchPaths(context);
  return resolveGitExecutable(context);
};

// Retain the local hooksPath marker and guard scripts, but enforce it at command scope too:
// inherited GIT_CONFIG_COUNT / PARAMETERS otherwise outrank repository-local configuration.
const withHooksPath = (runner: Runner, hooksPath: string): Runner => ({
  run: (cmd, args, opts) => runner.run(cmd, args, { ...opts, gitHooksPath: hooksPath }),
  get terminationFailed() {
    return runner.terminationFailed === true;
  },
});

export { assertGitEnvironment, gitArguments, prepareGitCommand, withHooksPath };
export type { GitPolicyContext, PreparedGit };
