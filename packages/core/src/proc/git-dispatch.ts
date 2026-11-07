import { REFUSED_EXIT_CODE, hookLabelPolicy, isVersionProbe } from './git-hook-label-policy.ts';
import type { RunOpts, RunResult } from './run-types.ts';
import { HookLabelCache } from './git-hook-label-cache.ts';

// The git-specific half of `SpawnRunner.run`: every git command except the version probe gets the
// configured-hook label arguments `git-hook-label-policy.ts` computes for it, or is refused.

type Spawn = (cmd: string, args: readonly string[], opts?: RunOpts) => Promise<RunResult>;

class GitDispatch {
  readonly #spawn: Spawn;
  // `git --version`, read once per runner: only git 2.54 and later need the configured-hook
  // inventory, which is then reused while nothing it read changes (`git-hook-label-cache.ts`).
  #gitVersion: Promise<string> | undefined;
  readonly #hookLabels = new HookLabelCache();

  constructor(spawn: Spawn) {
    this.#spawn = spawn;
  }

  async run(cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> {
    if (cmd !== 'git' || isVersionProbe(args)) {
      return this.#spawn(cmd, args, opts);
    }
    this.#gitVersion ??= this.#readVersion();
    // The inventory runs with the runner's own env, which already lacks `GIT_CONFIG`
    // (`child-env.ts`), so it lists what the guarded command reads.
    const labels = await hookLabelPolicy(
      (inventoryArgs) => this.#spawn('git', inventoryArgs, opts),
      {
        args,
        cache: this.#hookLabels,
        version: await this.#gitVersion,
        ...(opts?.cwd === undefined ? {} : { cwd: opts.cwd }),
      },
    );
    if ('refusal' in labels) {
      return { exitCode: REFUSED_EXIT_CODE, stderr: labels.refusal, stdout: '' };
    }
    return this.#spawn(cmd, [...labels.args, ...args], opts);
  }

  async #readVersion(): Promise<string> {
    const result = await this.#spawn('git', ['--version']);
    return result.stdout;
  }
}

export { GitDispatch };
