import type { RunOpts, RunResult, Runner } from '../proc/runner.ts';
import { failureMessage } from './failure-detail.ts';
import { validationError } from '../errors.ts';

// One git step that must succeed: the spec shape, and the runner call that turns a non-zero exit
// into a thrown error. Its own module so `repo.ts` (sync) and `clone.ts` share it without either
// passing the 300-line cap.

const SUCCESS_EXIT_CODE = 0;

type CommandSpec = {
  action: string;
  cmd: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs?: number;
};

const cwdOpt = (cwd: string | undefined): { cwd?: string } => (cwd === undefined ? {} : { cwd });

// `exactOptionalPropertyTypes`: an absent deadline must stay absent, never `timeoutMs: undefined`.
const runOpts = (cwd: string | undefined, timeoutMs: number | undefined): RunOpts => ({
  ...cwdOpt(cwd),
  ...(timeoutMs === undefined ? {} : { timeoutMs }),
});

// Shorthand for the `{ action, args, cmd: 'git', cwd }` shape passed to `runOrThrow` below.
const gitSpec = (action: string, args: readonly string[], cwd?: string): CommandSpec => ({
  action,
  args,
  cmd: 'git',
  ...cwdOpt(cwd),
});

// Runs one command and throws `validationError` on a non-zero exit — opts IN to "failure is an
// exception" on top of `Runner.run`'s "failure is data" contract, for steps with no sane way to
// continue past a failure (a failed clone/checkout/reset leaves nothing useful to return).
// Returns the whole `RunResult`, not just its two streams. The narrower shape was why `listTags`
// had to detect a capped stream by matching the note in `stderr`: `stdoutTruncated` is the fact
// the runner publishes, and it was not reachable through here.
const runOrThrow = async (runner: Runner, spec: CommandSpec): Promise<RunResult> => {
  const result = await runner.run(spec.cmd, spec.args, runOpts(spec.cwd, spec.timeoutMs));
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result;
  }
  throw validationError(failureMessage(spec.action, result, spec.timeoutMs));
};

export { gitSpec, runOpts, runOrThrow };
export type { CommandSpec };
