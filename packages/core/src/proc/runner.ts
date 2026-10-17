import { activeChildren, installCleanupOnce } from './spawn-cleanup.ts';
import { appendNote, createCollector, withTruncationNote } from './spawn-collector.ts';
import type { ChildProcess } from 'node:child_process';
import type { CollectedStream } from './spawn-collector.ts';
import { armTimeout } from './spawn-timeout.ts';
import { gitEnvironment } from './git-environment.ts';
import { gitTimeout } from './git-timeout.ts';
import { once } from 'node:events';
import { runProtectedGit } from './protected-git.ts';
import { spawn } from 'node:child_process';

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  /** Tree termination was not confirmed; callers must retain/quarantine any checkout. */
  terminationFailed?: true;
  stdoutTruncated?: true;
};

type RunOpts = {
  cwd?: string;
  timeoutMs?: number;
  gitHooksPath?: string;
};

type SpawnOpts = RunOpts & { gitEnvironment?: NodeJS.ProcessEnv; gitExecutable?: string };

type Runner = {
  readonly terminationFailed?: boolean;
  run: (cmd: string, args: readonly string[], opts?: RunOpts) => Promise<RunResult>;
};

const SIGNAL_KILLED_EXIT_CODE = 1;

const TIMEOUT_EXIT_CODE = 124;

const SPAWN_ERROR_EXIT_CODE = 127;

const cwdOpt = (cwd: string | undefined): { cwd?: string } => (cwd === undefined ? {} : { cwd });

const withTimeoutNote = (stderr: string, timeoutMs: number | undefined): string =>
  appendNote(stderr, `refs: command timed out after ${String(timeoutMs)}ms`);

const normalizeTimedOutResult = (stderr: string, timeoutMs: number | undefined): RunResult => ({
  exitCode: TIMEOUT_EXIT_CODE,
  stderr: withTimeoutNote(stderr, timeoutMs),
  stdout: '',
  timedOut: true,
});

type RunningChild = {
  child: ChildProcess;
  stdoutCollector: ReturnType<typeof createCollector>;
  stderrCollector: ReturnType<typeof createCollector>;
  timeout: ReturnType<typeof armTimeout>;
  timeoutMs: number | undefined;
};

const startChild = (
  cmd: string,
  args: readonly string[],
  opts: SpawnOpts | undefined,
): RunningChild => {
  const timeoutMs = gitTimeout(cmd, opts?.timeoutMs);
  const child = spawn(cmd === 'git' ? (opts?.gitExecutable ?? cmd) : cmd, args, {
    detached: process.platform !== 'win32',
    ...cwdOpt(opts?.cwd),
    ...(cmd === 'git' ? { env: opts?.gitEnvironment ?? gitEnvironment(process.env) } : {}),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChildren.add(child);
  const stdoutCollector = createCollector();
  const stderrCollector = createCollector();
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutCollector.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrCollector.push(chunk);
  });
  const timeout = armTimeout(child, timeoutMs);
  return { child, stderrCollector, stdoutCollector, timeout, timeoutMs };
};

const startChildSafely = (
  cmd: string,
  args: readonly string[],
  opts: SpawnOpts | undefined,
): RunningChild | RunResult => {
  try {
    return startChild(cmd, args, opts);
  } catch (error) {
    return { exitCode: SPAWN_ERROR_EXIT_CODE, stderr: errorMessageOf(error), stdout: '' };
  }
};

const isRunResult = (value: RunningChild | RunResult): value is RunResult => !('child' in value);

type CloseOutcome = {
  code: number | null;
  errorMessage?: string;
};

const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const waitForClose = async (child: ChildProcess): Promise<CloseOutcome> => {
  try {
    const [code] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null];
    return { code };
  } catch (error) {
    // eslint-disable-next-line unicorn/no-null -- mirrors node:child_process's own `code: null` contract for "no real exit code" (see `resolveExitCode`)
    return { code: null, errorMessage: errorMessageOf(error) };
  }
};

type CloseContext = {
  code: number | null;
  stdout: CollectedStream;
  stderr: CollectedStream;
  errorMessage: string | undefined;
  timedOut: boolean;
  timeoutMs: number | undefined;
};

const resolveExitCode = (code: number | null): number => {
  if (code === null) {
    return SIGNAL_KILLED_EXIT_CODE;
  }
  return code;
};

/** Whether this result's `stdout` is a PREFIX of what the command wrote.
 *
 * The one predicate for "do not trust these bytes as a whole answer". A caller that parses stdout
 * must consult it: the cut lands at a byte, so the last line may be a fragment — and worse, a
 * prefix of a structured document can parse perfectly well as a smaller, different document. */
const isTruncated = (result: RunResult): boolean => result.stdoutTruncated === true;

const withStdoutTruncation = (result: RunResult, stdout: CollectedStream): RunResult => {
  if (!stdout.truncated) {
    return result;
  }
  return { ...result, stdoutTruncated: true };
};

const buildCloseResult = (ctx: CloseContext): RunResult => {
  if (ctx.timedOut) {
    return withStdoutTruncation(
      normalizeTimedOutResult(ctx.stderr.text, ctx.timeoutMs),
      ctx.stdout,
    );
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

const unsafeResult = (message: string): RunResult => ({
  exitCode: TIMEOUT_EXIT_CODE,
  stderr: message,
  stdout: '',
  terminationFailed: true,
  timedOut: true,
});

const finishChild = async (running: RunningChild, outcome: CloseOutcome): Promise<RunResult> => {
  const failure = await running.timeout.finish();
  if (failure !== undefined) {
    running.child.stdout?.destroy();
    running.child.stderr?.destroy();
    running.child.unref();
    return unsafeResult(withTimeoutNote(failure, running.timeoutMs));
  }
  activeChildren.delete(running.child);
  return buildCloseResult({
    code: outcome.code,
    errorMessage: outcome.errorMessage,
    stderr: running.stderrCollector.finish(),
    stdout: running.stdoutCollector.finish(),
    timedOut: running.timeout.markedTimedOut(),
    timeoutMs: running.timeoutMs,
  });
};

const runProcess = async (
  cmd: string,
  args: readonly string[],
  opts?: SpawnOpts,
): Promise<RunResult> => {
  installCleanupOnce();
  const running = startChildSafely(cmd, args, opts);
  if (isRunResult(running)) {
    return running;
  }
  const outcome = await Promise.race([
    waitForClose(running.child),
    // eslint-disable-next-line unicorn/no-null -- same signal-killed shape as waitForClose
    running.timeout.failure.then((errorMessage) => ({ code: null, errorMessage })),
  ]);
  return finishChild(running, outcome);
};

class SpawnRunner implements Runner {
  terminationFailed = false;

  readonly #gitHooksPath: string | undefined;

  constructor(gitHooksPath?: string) {
    this.#gitHooksPath = gitHooksPath;
  }

  async #runRaw(cmd: string, args: readonly string[], opts?: SpawnOpts): Promise<RunResult> {
    const result = this.terminationFailed
      ? unsafeResult('refs: refusing further commands after unconfirmed subprocess termination')
      : await runProcess(cmd, args, opts);
    this.terminationFailed ||= result.terminationFailed === true;
    return result;
  }

  async run(cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> {
    const configured =
      this.#gitHooksPath === undefined ? opts : { gitHooksPath: this.#gitHooksPath, ...opts };
    const result =
      cmd === 'git'
        ? await runProtectedGit(
            (query, options) => this.#runRaw('git', query, options),
            args,
            configured,
          )
        : await this.#runRaw(cmd, args, configured);
    return this.terminationFailed && result.terminationFailed !== true
      ? unsafeResult('refs: Git safety inventory could not confirm subprocess termination')
      : result;
  }
}

export {
  SIGNAL_KILLED_EXIT_CODE,
  SPAWN_ERROR_EXIT_CODE,
  SpawnRunner,
  TIMEOUT_EXIT_CODE,
  isTruncated,
};
export type { Runner, RunOpts, RunResult, SpawnOpts };
