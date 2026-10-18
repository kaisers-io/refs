import type { RunOpts, RunResult } from './runner.ts';
import { homedir, tmpdir } from 'node:os';
import type { ConfigGit } from './git-hook-labels.ts';
import { gitVersionRefusal } from './git-version-gate.ts';
import { hookLabelPolicy } from './git-hook-labels.ts';

// What a runner decides once before it starts git: whether this git may run at all
// (git-version-gate.ts), and the per-label hook switches it needs (git-hook-labels.ts).

type GitGate = { labelArgs: readonly string[]; refusal?: string | undefined };
// Starts git with refs' policy options but without the label switches the gate is computing.
type SpawnGit = (args: readonly string[], opts: RunOpts) => Promise<RunResult>;

// Everything that can change which git runs or which configuration it reads. A runner keeps one
// gate per value, so a process that points GIT_CONFIG_GLOBAL somewhere else (the test suite does)
// gets a fresh inventory, and every other command reuses the first one. Looked up by name rather
// than by scanning the environment: this runs before every git command, and a scan cost ~50 µs
// each, measurable over the thousands of `check-ref-format` calls in a test file. (On Windows
// `process.env` lookups ignore case.) GIT_DIR and the other repository variables are not passed to
// git at all (child-env.ts).
const CONFIG_ENV = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'XDG_CONFIG_HOME',
  'PREFIX',
  'GIT_EXEC_PATH',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
] as const;
// `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` pairs read past this many are left out of the key;
// the count itself is in it.
const MAX_CONFIG_PAIRS = 100;

const configPairs = (env: NodeJS.ProcessEnv): (string | undefined)[] => {
  const count = Math.min(Math.trunc(Number(env['GIT_CONFIG_COUNT'])) || 0, MAX_CONFIG_PAIRS);
  return Array.from({ length: Math.max(count, 0) }, (_unused, index) => [
    env[`GIT_CONFIG_KEY_${String(index)}`],
    env[`GIT_CONFIG_VALUE_${String(index)}`],
  ]).flat();
};

const configEnvKey = (env: NodeJS.ProcessEnv): string =>
  JSON.stringify([...CONFIG_ENV.map((name) => env[name]), ...configPairs(env)]);

// What git expands `~/` to: $HOME, which Git for Windows also sets from the profile when missing.
const gitHome = (): string => process.env['HOME'] ?? homedir();

/** Probes `git --version`, then (2.55+) inventories hook labels, outside any repository. A failed
 * probe (no git at all) refuses nothing: the real command then fails with its own, clearer error. */
const probeGitGate = async (
  spawnGit: SpawnGit,
  sourcesDir: string | undefined,
): Promise<GitGate> => {
  const git: ConfigGit = (args) => spawnGit(args, { cwd: tmpdir() });
  const probe = await git(['--version']);
  const refusal = gitVersionRefusal(probe.stdout);
  if (refusal !== undefined || probe.exitCode !== 0) {
    return { labelArgs: [], refusal };
  }
  const policy = await hookLabelPolicy(probe.stdout, { git, home: gitHome(), sourcesDir });
  return policy.refusal === undefined
    ? { labelArgs: policy.args }
    : { labelArgs: [], refusal: policy.refusal };
};

/** One gate per configuration environment: the first git command under it probes, every later one
 * reuses the answer. */
class GitGates {
  readonly #gates = new Map<string, Promise<GitGate>>();

  for(spawnGit: SpawnGit, sourcesDir: string | undefined): Promise<GitGate> {
    const key = configEnvKey(process.env);
    const known = this.#gates.get(key);
    if (known !== undefined) {
      return known;
    }
    const gate = probeGitGate(spawnGit, sourcesDir);
    this.#gates.set(key, gate);
    return gate;
  }
}

export { GitGates, configEnvKey, probeGitGate };
export type { GitGate, SpawnGit };
