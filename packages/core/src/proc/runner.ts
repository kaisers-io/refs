import { activeChildren, installCleanupOnce } from './spawn-cleanup.ts';
import { appendNote, createCollector, withTruncationNote } from './spawn-collector.ts';
import type { ChildProcess } from 'node:child_process';
import { armTimeout } from './spawn-timeout.ts';
import { once } from 'node:events';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { spawn } from 'node:child_process';

// Thin process-execution seam so `git/repo.ts` never calls `child_process` directly: production
// Code depends on `Runner`, tests depend on `FakeRunner` (fake-runner.ts), and only `SpawnRunner`
// Touches a real child process. `run()` never throws on a non-zero exit — a failed git command is
// Data (inspect `exitCode`/`stderr`), not a control-flow exception; callers decide what a given
// Exit code means for their operation.
//
// Built directly on `node:child_process.spawn` (never `execFile`/promisified variants, whose
// throw-on-everything semantics fight the never-throw contract above, and never `shell: true` —
// every caller passes `cmd`/`args` as separate values, so there is never a shell to inject into).
// Byte-capped stream collection lives in `spawn-collector.ts`, `timeoutMs` escalation in
// `spawn-timeout.ts`, and parent-death child cleanup in `spawn-cleanup.ts` — split out purely to
// keep every file under the repo's 300-line oxlint cap.

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  // Present-and-`true` only when the collector's byte cap cut `stdout` short (see
  // `spawn-collector.ts`) — never an explicit `false`, so callers branch on `=== true`. Callers
  // that parse `stdout` line-by-line MUST treat a byte-truncated result as incomplete: the last
  // line may be a partial fragment, and counting lines no longer proves anything about how much
  // output the child really produced.
  stdoutTruncated?: true;
}

interface RunOpts {
  cwd?: string;
  timeoutMs?: number;
}

interface Runner {
  run: (cmd: string, args: readonly string[], opts?: RunOpts) => Promise<RunResult>;
}

// A killed-by-signal result has no real exit code — fall back to a generic non-zero code so
// `Runner.run`'s contract (`exitCode: number`, never throws) always holds.
const SIGNAL_KILLED_EXIT_CODE = 1;

// `timeout(1)`'s own well-known "command timed out" exit code convention, reused here (rather than
// inventing a fresh number) purely so log/detail output reads familiarly. It is NOT a reliable
// signal on its own — a child can genuinely exit 124 of its own accord — so callers that need to
// distinguish "this `run()` was killed by its own `timeoutMs`" from a real exit 124 must branch on
// `RunResult.timedOut` (below) instead of this code.
const TIMEOUT_EXIT_CODE = 124;

// Node's own `spawn()` reports a failure to even start the child (ENOENT, EACCES, ...) via an
// `error` event rather than a normal exit — `127` is the shell convention for "command not found",
// reused here for the same "reads familiarly in logs" reason as `TIMEOUT_EXIT_CODE` above. Nothing
// in this codebase branches on this exact number today (every caller either checks
// `exitCode === 0` or reads `stderr`), so there is no compatibility reason to pick anything else.
const SPAWN_ERROR_EXIT_CODE = 127;

const cwdOpt = (cwd: string | undefined): { cwd?: string } => {
  if (cwd === undefined) {
    return {};
  }
  return { cwd };
};

const withTimeoutNote = (stderr: string, timeoutMs: number | undefined): string =>
  appendNote(stderr, `refs: command timed out after ${String(timeoutMs)}ms`);

// Normalizes a `run()` killed by its own `timeoutMs` into the plain `RunResult` shape both callers
// and `FakeRunner` already understand: `TIMEOUT_EXIT_CODE` for readable logging, `timedOut: true`
// as the actual, unambiguous signal a caller must branch on (a real child that exits 124 on its
// own gets this same `exitCode` but never this flag), and the timeout note so `--verbose`/log
// output still explains why the command has no real output. `stdout` is always discarded here —
// a killed child's partial stdout is not interesting, matching this runner's original design.
const normalizeTimedOutResult = (stderr: string, timeoutMs: number | undefined): RunResult => ({
  exitCode: TIMEOUT_EXIT_CODE,
  stderr: withTimeoutNote(stderr, timeoutMs),
  stdout: '',
  timedOut: true,
});

interface RunningChild {
  child: ChildProcess;
  stdoutCollector: ReturnType<typeof createCollector>;
  stderrCollector: ReturnType<typeof createCollector>;
  timeout: ReturnType<typeof armTimeout>;
}

const startChild = (
  cmd: string,
  args: readonly string[],
  opts: RunOpts | undefined,
): RunningChild => {
  const child = spawn(cmd, args, { ...cwdOpt(opts?.cwd), stdio: ['ignore', 'pipe', 'pipe'] });
  activeChildren.add(child);
  const stdoutCollector = createCollector();
  const stderrCollector = createCollector();
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutCollector.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrCollector.push(chunk);
  });
  const timeout = armTimeout(child, opts?.timeoutMs);
  return { child, stderrCollector, stdoutCollector, timeout };
};

// The never-throw contract's last hole: `spawn()` itself can throw SYNCHRONOUSLY on an invalid
// argument shape (e.g. an empty `cmd` throws ERR_INVALID_ARG_VALUE) — before any `error` event
// could ever fire. Unreachable from today's call sites (all pass literal 'git'/'ssh'), but the
// `Runner` contract is frozen: no input may escape `run()` as a rejection. Normalized to the same
// `SPAWN_ERROR_EXIT_CODE` shape as the async `error`-event path (`waitForClose`'s catch below).
const startChildSafely = (
  cmd: string,
  args: readonly string[],
  opts: RunOpts | undefined,
): RunningChild | RunResult => {
  try {
    return startChild(cmd, args, opts);
  } catch (error) {
    return { exitCode: SPAWN_ERROR_EXIT_CODE, stderr: errorMessageOf(error), stdout: '' };
  }
};

const isRunResult = (value: RunningChild | RunResult): value is RunResult => !('child' in value);

interface CloseOutcome {
  code: number | null;
  errorMessage?: string;
}

const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

// `node:events`' `once()` gives `'error'` special handling: awaiting any OTHER event (here,
// `'close'`) still rejects the returned promise if the child ever emits `'error'` (ENOENT,
// EACCES, ...) — regardless of whether a plain `.on('error', ...)` listener is also attached.
// Catching that rejection is what turns a spawn failure into `RunResult` data instead of a thrown
// exception, preserving `Runner.run`'s never-throw contract. `close` itself still resolves this
// promise in every other case — including a genuinely signal-killed child (`code: null`) — so
// resolution always happens once the child's stdio streams are fully drained, never on `exit`.
const waitForClose = async (child: ChildProcess): Promise<CloseOutcome> => {
  try {
    const [code] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
    return { code };
  } catch (error) {
    // eslint-disable-next-line unicorn/no-null -- mirrors node:child_process's own `code: null` contract for "no real exit code" (see `resolveExitCode`)
    return { code: null, errorMessage: errorMessageOf(error) };
  }
};

// Derived from `createCollector`'s own return type rather than a separate `import type` of
// `CollectedStream` from `spawn-collector.ts` — importing both the value AND the type from that
// module would trigger the same `no-duplicate-imports`/`consistent-type-specifier-style` conflict
// documented in `state-io.ts`; deriving locally sidesteps it while staying byte-for-byte the same
// shape `spawn-collector.ts` actually returns.
type CollectedStream = ReturnType<ReturnType<typeof createCollector>['finish']>;

interface CloseContext {
  code: number | null;
  stdout: CollectedStream;
  stderr: CollectedStream;
  errorMessage: string | undefined;
  timedOut: boolean;
  timeoutMs: number | undefined;
}

const resolveExitCode = (code: number | null): number => {
  if (code === null) {
    return SIGNAL_KILLED_EXIT_CODE;
  }
  return code;
};

// `exactOptionalPropertyTypes` + the `stdoutTruncated?: true` shape (see `RunResult`): the flag
// is added only when the stdout collector actually hit its byte cap, never set to `false`.
const withStdoutTruncation = (result: RunResult, stdout: CollectedStream): RunResult => {
  if (!stdout.truncated) {
    return result;
  }
  return { ...result, stdoutTruncated: true };
};

const buildCloseResult = (ctx: CloseContext): RunResult => {
  if (ctx.timedOut) {
    return normalizeTimedOutResult(ctx.stderr.text, ctx.timeoutMs);
  }
  if (ctx.errorMessage !== undefined) {
    return withStdoutTruncation(
      {
        exitCode: SPAWN_ERROR_EXIT_CODE,
        stderr: appendNote(ctx.stderr.text, ctx.errorMessage),
        stdout: ctx.stdout.text,
      },
      ctx.stdout,
    );
  }
  return withStdoutTruncation(
    {
      exitCode: resolveExitCode(ctx.code),
      stderr: withTruncationNote(ctx.stderr.text, ctx.stdout, ctx.stderr),
      stdout: ctx.stdout.text,
    },
    ctx.stdout,
  );
};

class SpawnRunner implements Runner {
  async run(cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> {
    installCleanupOnce();
    const running = startChildSafely(cmd, args, opts);
    if (isRunResult(running)) {
      return running;
    }
    const outcome = await waitForClose(running.child);
    activeChildren.delete(running.child);
    running.timeout.clear();
    return buildCloseResult({
      code: outcome.code,
      errorMessage: outcome.errorMessage,
      stderr: running.stderrCollector.finish(),
      stdout: running.stdoutCollector.finish(),
      timedOut: running.timeout.markedTimedOut(),
      timeoutMs: opts?.timeoutMs,
    });
  }
}

export { SIGNAL_KILLED_EXIT_CODE, SPAWN_ERROR_EXIT_CODE, SpawnRunner, TIMEOUT_EXIT_CODE };
export type { Runner, RunOpts, RunResult };
