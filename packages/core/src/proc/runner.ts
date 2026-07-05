import { execa } from 'execa';

// Thin process-execution seam so `git/repo.ts` never calls `execa` directly: production code
// Depends on `Runner`, tests depend on `FakeRunner` (fake-runner.ts), and only `ExecaRunner`
// Touches a real child process. `run()` never throws on a non-zero exit — a failed git command is
// Data (inspect `exitCode`/`stderr`), not a control-flow exception; callers decide what a given
// Exit code means for their operation.

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

interface RunOpts {
  cwd?: string;
  timeoutMs?: number;
}

interface Runner {
  run: (cmd: string, args: readonly string[], opts?: RunOpts) => Promise<RunResult>;
}

// A killed-by-signal execa result has `exitCode: undefined` — fall back to a generic non-zero
// Code so `Runner.run`'s contract (`exitCode: number`, never throws) always holds.
const SIGNAL_KILLED_EXIT_CODE = 1;

// `timeout(1)`'s own well-known "command timed out" exit code convention, reused here (rather than
// inventing a fresh number) purely so log/detail output reads familiarly. It is NOT a reliable
// signal on its own — a child can genuinely exit 124 of its own accord — so callers that need to
// distinguish "this `run()` was killed by its own `timeoutMs`" from a real exit 124 must branch on
// `RunResult.timedOut` (below) instead of this code.
const TIMEOUT_EXIT_CODE = 124;

const cwdOpt = (cwd: string | undefined): { cwd?: string } => {
  if (cwd === undefined) {
    return {};
  }
  return { cwd };
};

const timeoutOpt = (timeoutMs: number | undefined): { timeout?: number } => {
  if (timeoutMs === undefined) {
    return {};
  }
  return { timeout: timeoutMs };
};

// Appends a synthetic timeout note to `stderr` rather than replacing it — the child's own partial
// stderr (if it printed anything before being killed) stays visible alongside the reason it never
// finished.
const withTimeoutNote = (stderr: string, timeoutMs: number | undefined): string => {
  const note = `refs: command timed out after ${String(timeoutMs)}ms`;
  return [stderr, note].filter((part) => part !== '').join('\n');
};

// Execa (with `reject: false`) reports a command it killed for exceeding its own `timeout` option
// via `timedOut: true` and `exitCode: undefined` (never a real process exit code — the child never
// produced one). Normalized here into the plain `RunResult` shape both callers and `FakeRunner`
// already understand: `TIMEOUT_EXIT_CODE` for readable logging, `timedOut: true` as the actual,
// unambiguous signal a caller must branch on (a real child that exits 124 on its own gets this
// same `exitCode` but never this flag), and the timeout note above so `--verbose`/log output still
// explains why the command has no real output.
const normalizeTimedOutResult = (stderr: string, timeoutMs: number | undefined): RunResult => ({
  exitCode: TIMEOUT_EXIT_CODE,
  stderr: withTimeoutNote(stderr, timeoutMs),
  stdout: '',
  timedOut: true,
});

class ExecaRunner implements Runner {
  async run(cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> {
    const result = await execa(cmd, args, {
      ...cwdOpt(opts?.cwd),
      ...timeoutOpt(opts?.timeoutMs),
      reject: false,
    });
    if (result.timedOut) {
      return normalizeTimedOutResult(result.stderr, opts?.timeoutMs);
    }
    return {
      exitCode: result.exitCode ?? SIGNAL_KILLED_EXIT_CODE,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }
}

export { ExecaRunner, TIMEOUT_EXIT_CODE };
export type { Runner, RunOpts, RunResult };
