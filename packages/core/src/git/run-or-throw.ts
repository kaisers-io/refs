import type { RunResult, Runner } from '../proc/runner.ts';
import { GIT_TIMEOUT_VARIABLE } from '../proc/timeout-policy.ts';
import { TERMINAL_PROMPT_VARIABLE } from '../proc/spawn-env.ts';
import { failureDetail } from './failure-detail.ts';
import { validationError } from '../errors.ts';

// The "failure is an exception" seam for git steps, moved out of `repo.ts` when that file reached
// the 300-line cap. It also names the two ways refs itself can be why a git step failed — its
// default `GIT_TERMINAL_PROMPT=0` (spawn-env.ts) and its command timeout (timeout-policy.ts) —
// because git's own words for either do not say that refs is involved or how to change it.

type CommandSpec = {
  action: string;
  cmd: string;
  args: readonly string[];
  cwd?: string;
};

const SUCCESS_EXIT_CODE = 0;

// git's wording when it needed a username or password and was not allowed to ask (git 2.43:
// "fatal: could not read Username for 'https://…': terminal prompts disabled").
const PROMPT_DISABLED_PATTERN = /terminal prompts disabled/iu;

const PROMPT_HINT =
  'git needed credentials and refs does not let git prompt for them: configure a git credential ' +
  `helper or GIT_ASKPASS, or set ${TERMINAL_PROMPT_VARIABLE}=1 to type them in a terminal`;

const TIMEOUT_HINT =
  `set ${GIT_TIMEOUT_VARIABLE} to a number of seconds to allow longer, or ` +
  `${GIT_TIMEOUT_VARIABLE}=0 for no limit`;

const cwdOpt = (cwd: string | undefined): { cwd?: string } => (cwd === undefined ? {} : { cwd });

// Shorthand for the `{ action, args, cmd: 'git', cwd }` shape passed to `runOrThrow` below.
const gitSpec = (action: string, args: readonly string[], cwd?: string): CommandSpec => ({
  action,
  args,
  cmd: 'git',
  ...cwdOpt(cwd),
});

/** The hint for a failure refs' own settings caused, if this is one. */
const hintFor = (result: RunResult, raw: string): string | undefined => {
  if (result.timedOut === true) {
    return TIMEOUT_HINT;
  }
  return PROMPT_DISABLED_PATTERN.test(raw) ? PROMPT_HINT : undefined;
};

/** The message for a failed step: git's output, redacted and bounded, then any hint. */
const failureMessage = (action: string, result: RunResult): string => {
  const raw = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  const hint = hintFor(result, raw);
  const detail = `${action} failed: ${failureDetail(raw)}`;
  return hint === undefined ? detail : `${detail} — ${hint}`;
};

// Runs one command and throws `validationError` on a non-zero exit — opts IN to "failure is an
// exception" on top of `Runner.run`'s "failure is data" contract, for steps with no sane way to
// continue past a failure (a failed clone/checkout/reset leaves nothing useful to return).
// Returns the whole `RunResult`, not just its two streams. The narrower shape was why `listTags`
// had to detect a capped stream by matching the note in `stderr`: `stdoutTruncated` is the fact
// the runner publishes, and it was not reachable through here.
const runOrThrow = async (runner: Runner, spec: CommandSpec): Promise<RunResult> => {
  const result = await runner.run(spec.cmd, spec.args, cwdOpt(spec.cwd));
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result;
  }
  throw validationError(failureMessage(spec.action, result));
};

export { gitSpec, runOrThrow };
export type { CommandSpec };
