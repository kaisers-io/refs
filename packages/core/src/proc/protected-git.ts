import type { RunOpts, RunResult, SpawnOpts } from './runner.ts';
import { assertGitEnvironment, prepareGitCommand } from './git-policy.ts';
import { gitEnvironment } from './git-environment.ts';
import { gitTimeout } from './git-timeout.ts';

// All raw inventory calls use the runner's termination latch, not a fresh child boundary.
const POLICY_REFUSAL_EXIT_CODE = 127;
const CONFIG_TIMEOUT_MS = 5000;

type RawGit = (args: readonly string[], opts?: SpawnOpts) => Promise<RunResult>;

const runProtectedGit = async (
  run: RawGit,
  args: readonly string[],
  opts?: RunOpts,
): Promise<RunResult> => {
  try {
    const context = {
      args,
      ...(opts?.cwd === undefined ? {} : { cwd: opts.cwd }),
      ...(opts?.gitHooksPath === undefined ? {} : { hooksPath: opts.gitHooksPath }),
    };
    const gitExecutable = await assertGitEnvironment(context);
    if (args[0] === 'config' || args[0] === '--version') {
      return run(args, { ...opts, gitExecutable });
    }
    const prepared = await prepareGitCommand(
      (query) =>
        run(query, {
          ...opts,
          gitEnvironment: { ...gitEnvironment(process.env), LC_ALL: 'C' },
          gitExecutable,
          timeoutMs: Math.min(
            CONFIG_TIMEOUT_MS,
            gitTimeout('git', opts?.timeoutMs) || CONFIG_TIMEOUT_MS,
          ),
        }),
      context,
    );
    return run(prepared.args, {
      ...opts,
      gitEnvironment: prepared.env,
      gitExecutable,
    });
  } catch (error) {
    return {
      exitCode: POLICY_REFUSAL_EXIT_CODE,
      stderr: `refs: refusing Git operation: ${error instanceof Error ? error.message : String(error)}`,
      stdout: '',
    };
  }
};

export { runProtectedGit };
