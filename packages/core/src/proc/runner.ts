import { REFUSED_EXIT_CODE, isVersionProbe } from './git-version-gate.ts';
import { activeChildren, installCleanupOnce } from './spawn-cleanup.ts';
import { appendNote, createCollector, withTruncationNote } from './spawn-collector.ts';
import { armTimeout, deadlineSpawnOpts } from './spawn-timeout.ts';
import type { ChildProcess } from 'node:child_process';
import type { CollectedStream } from './spawn-collector.ts';
import { GitGates } from './git-gate.ts';
import type { GitPolicyOpts } from './git-policy.ts';
import { once } from 'node:events';
import { resolveExecutable } from './executable-path.ts';
import { sanitizedChildEnv } from './child-env.ts';
import { spawn } from 'node:child_process';
import { withGitPolicy } from './git-policy.ts';

// Thin process-execution seam so `git/repo.ts` never calls `child_process` directly: production
// code depends on `Runner`, tests depend on `FakeRunner` (fake-runner.ts), and only `SpawnRunner`
// touches a real child process. `run()` never throws on a non-zero exit — a failed git command is
// data (inspect `exitCode`/`stderr`), not a control-flow exception; callers decide what a given
// exit code means for their operation.
//
// Built on `spawn` (not `execFile`, whose throwing fights that contract; never `shell: true`), and
// always on an absolute path (executable-path.ts). Stream caps: `spawn-collector.ts`; timeouts:
// `spawn-timeout.ts`; parent-death cleanup: `spawn-cleanup.ts`.

type RunResult = {
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
};

type RunOpts = {
  cwd?: string;
  timeoutMs?: number;
};

type Runner = {
  run: (cmd: string, args: readonly string[], opts?: RunOpts) => Promise<RunResult>;
};

// A killed-by-signal result has no real exit code — fall back to a generic non-zero code so
// `Runner.run`'s contract (`exitCode: number`, never throws) always holds.
const SIGNAL_KILLED_EXIT_CODE = 1;

// `timeout(1)`'s "command timed out" exit code, reused so log output reads familiarly. NOT a
// reliable signal on its own (a child can exit 124 itself): to tell "killed by its own
// `timeoutMs`" from a real exit 124, callers branch on `RunResult.timedOut` instead.
const TIMEOUT_EXIT_CODE = 124;

// A child that could not start (not on PATH, ENOENT, EACCES, ...): `127` is the shell convention
// for "command not found", reused, like `TIMEOUT_EXIT_CODE`, so logs read familiarly. Nothing
// branches on this exact number; callers check `exitCode === 0` or read `stderr`.
const SPAWN_ERROR_EXIT_CODE = 127;

const cwdOpt = (cwd: string | undefined): { cwd?: string } => (cwd === undefined ? {} : { cwd });

const withTimeoutNote = (stderr: string, timeoutMs: number | undefined): string =>
  appendNote(stderr, `refs: command timed out after ${String(timeoutMs)}ms`);

// Normalizes a `run()` killed by its own `timeoutMs` into the plain `RunResult` shape both callers
// and `FakeRunner` already understand: `TIMEOUT_EXIT_CODE` for readable logging, `timedOut: true`
// as the actual, unambiguous signal a caller must branch on (a real child that exits 124 on its
// own gets this same `exitCode` but never this flag), and the timeout note so `--verbose`/log
// output still explains why the command has no real output. A timed-out command's partial
// stdout is never useful to callers, so it is discarded.
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
};

// `file`: the absolute path `cmd` resolved to; `cmd` still decides policy.
type StartOpts = RunOpts & GitPolicyOpts & { file: string };

const startChild = (cmd: string, args: readonly string[], opts: StartOpts): RunningChild => {
  // `shell: false` is Node's default, so this changes nothing at runtime — it states the property
  // the rest of the codebase rests on. Every argument refs passes to git is built from values a
  // tracked repository or the user supplied (a url, a ref key, a package path), and none of them is
  // shell-quoted on the way in, because there is no shell to quote for: `spawn` with an argv array
  // performs an execve. Measured with a `-c core.hooksPath=/tmp/hooks; touch /tmp/PWNED` value —
  // the file is not created. Code scanning's `js/shell-command-constructed-from-input` findings
  // here are false positives.
  //
  // `env` is a sanitized COPY of the parent's (child-env.ts): `cwd` is how refs names a repository,
  // and an inherited `GIT_DIR` would silently override it. A git command also gets refs' policy
  // options in front (git-policy.ts), so no call site can forget them.
  const child = spawn(opts.file, withGitPolicy(cmd, args, opts), {
    ...cwdOpt(opts.cwd),
    ...deadlineSpawnOpts(opts.timeoutMs),
    env: sanitizedChildEnv(process.env),
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
  const timeout = armTimeout(child, opts.timeoutMs, spawn);
  return { child, stderrCollector, stdoutCollector, timeout };
};

// The never-throw contract's last hole: `spawn()` can throw SYNCHRONOUSLY on an invalid argument
// shape, before any `error` event. Unreachable from today's call sites, but no input may escape
// `run()` as a rejection, so it gets the same `SPAWN_ERROR_EXIT_CODE` shape as `waitForClose`.
const startChildSafely = (
  cmd: string,
  args: readonly string[],
  opts: StartOpts,
): RunningChild | RunResult => {
  try {
    return startChild(cmd, args, opts);
  } catch (error) {
    return { exitCode: SPAWN_ERROR_EXIT_CODE, stderr: errorMessageOf(error), stdout: '' };
  }
};

// Never spawn the bare name: on Windows that searches the child's cwd, a checkout, first.
const startResolved = async (
  cmd: string,
  args: readonly string[],
  opts: Omit<StartOpts, 'file'>,
): Promise<RunningChild | RunResult> => {
  const file = await resolveExecutable(cmd, process.env);
  if (file === undefined) {
    const stderr = `spawn ${cmd} ENOENT: not in an absolute PATH directory (refs never runs a program from the working directory)`;
    return { exitCode: SPAWN_ERROR_EXIT_CODE, stderr, stdout: '' };
  }
  return startChildSafely(cmd, args, { ...opts, file });
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

// `once(child, 'close')` rejects if the child emits `'error'` (ENOENT, EACCES, ...), even with an
// `.on('error')` listener attached; catching that keeps `run()` from throwing. Otherwise `close`
// resolves, signal kills included (`code: null`), and only after stdio has drained, never on `exit`.
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
    // Truncation is published here too. A run can both hit the stream cap and then time out, and
    // this branch reported only the timeout, dropping the flag — not disagreeing with the stderr
    // note, which this branch never reaches either, but silently losing the fact. Unreachable for
    // every caller that branches on `timedOut` or on the exit code first, which is why it never
    // showed. The flag is what callers are told to trust, so it has to be right wherever it is
    // computed.
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

// `hooksDir`: pinned as `core.hooksPath` on every git command. `sourcesDir`: refs' checkouts, which
// no git include may point into. The gate (git-gate.ts) runs once per configuration environment.
type SpawnRunnerOpts = { hooksDir?: string | undefined; sourcesDir?: string | undefined };

class SpawnRunner implements Runner {
  readonly #hooksDir: string | undefined;
  readonly #sourcesDir: string | undefined;
  readonly #gates = new GitGates();

  constructor(opts: SpawnRunnerOpts = {}) {
    this.#hooksDir = opts.hooksDir;
    this.#sourcesDir = opts.sourcesDir;
  }

  async run(cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> {
    if (cmd !== 'git' || isVersionProbe(args)) {
      return this.#spawn(cmd, args, opts);
    }
    const probe = (probeArgs: readonly string[], probeOpts: RunOpts): Promise<RunResult> =>
      this.#spawn('git', probeArgs, probeOpts);
    const gate = await this.#gates.for(probe, this.#sourcesDir);
    if (gate.refusal !== undefined) {
      return { exitCode: REFUSED_EXIT_CODE, stderr: gate.refusal, stdout: '' };
    }
    return this.#spawn(cmd, args, { ...opts, labelArgs: gate.labelArgs });
  }

  async #spawn(
    cmd: string,
    args: readonly string[],
    opts?: RunOpts & GitPolicyOpts,
  ): Promise<RunResult> {
    installCleanupOnce();
    const running = await startResolved(cmd, args, { ...opts, hooksDir: this.#hooksDir });
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

export {
  SIGNAL_KILLED_EXIT_CODE,
  SPAWN_ERROR_EXIT_CODE,
  SpawnRunner,
  TIMEOUT_EXIT_CODE,
  isTruncated,
};
export type { Runner, RunOpts, RunResult, SpawnRunnerOpts };
