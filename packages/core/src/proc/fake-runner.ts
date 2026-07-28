import type { RunOpts, RunResult, Runner } from './runner.ts';

// Scripted `Runner` for unit tests of code that depends on git commands but must not shell out for
// Real (that's what the `git/repo.ts` integration suite is for). Kept under `src/` rather than
// `test/` — it is shipped source, deliberately: the CLI package (and any future consumer) imports
// It for its own unit tests instead of re-implementing a fake.
//
// Usage: `runner.expect('git status', { stdout: '...' })` queues one scripted response, matched
// FIFO against the next `run()` call by prefix (`${cmd} ${args.join(' ')}` must start with
// `cmdPrefix`). Calling `run()` with nothing queued, or against a mismatched prefix, throws
// Immediately — a fake that silently returned defaults would hide a caller bug instead of failing
// The test that exercises it.
//
// Prefix matching is intentionally loose, not exact: `expect('git fetch', ...)` matches an actual
// Call of `git fetch --prune --tags origin` — the short form is shorthand for tests that don't
// Care about the full argument list. Pass the FULL `cmd + args` string (e.g.
// `'git fetch --prune --tags origin'`) whenever two scripted commands could otherwise be confused
// With each other (two `git reset --hard <ref>` calls against different refs, for example).
//
// Every call — matched or not yet asserted on — is recorded in `calls`, in invocation order,
// Including its `cwd` when the caller passed one. Tests can inspect `calls` directly, or pass
// `{ cwd }` as `expect()`'s third argument to assert the *next* call's cwd inline with its
// Scripted response.
//
// `exitCode: 124` alone never means "timed out" — a real child can exit 124 on its own. Script
// `{ exitCode: 124, timedOut: true }` for a genuine `SpawnRunner`-style timeout, and plain
// `{ exitCode: 124 }` (no `timedOut`) for a real command that just happens to exit 124; a caller
// that branches on `RunResult.timedOut` treats the two differently, per `runner.ts`'s contract.

type FakeResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
  // Mirrors `RunResult.stdoutTruncated` (runner.ts): script `{ stdoutTruncated: true }` to
  // simulate a child whose stdout hit `SpawnRunner`'s byte cap; omitted otherwise, exactly as
  // `SpawnRunner` itself omits the flag.
  stdoutTruncated?: true;
};

type FakeRunnerCall = {
  cmd: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs?: number;
};

type ScriptedCall = {
  cmdPrefix: string;
  result: FakeResult;
  cwd?: string;
};

const DEFAULT_EXIT_CODE = 0;
const DEFAULT_STDOUT = '';
const DEFAULT_STDERR = '';
const DEFAULT_TIMED_OUT = false;

class FakeRunner implements Runner {
  readonly calls: FakeRunnerCall[] = [];
  readonly #queue: ScriptedCall[] = [];

  expect(cmdPrefix: string, result: FakeResult, opts?: { cwd?: string }): void {
    const scripted: ScriptedCall = { cmdPrefix, result };
    if (opts?.cwd !== undefined) {
      scripted.cwd = opts.cwd;
    }
    this.#queue.push(scripted);
  }

  // `opts.timeoutMs` is accepted purely so call sites can pass the same `RunOpts` shape
  // `SpawnRunner` does — recorded on `calls` for tests that want to assert it was forwarded, but
  // otherwise ignored: `FakeRunner` always resolves synchronously with its scripted response, so
  // there is no real wall-clock wait for a timeout to race against.
  run(cmd: string, args: readonly string[], opts?: RunOpts): Promise<RunResult> {
    this.#record(cmd, args, opts);
    const next = this.#matchNext([cmd, ...args].join(' '), opts);
    const result: RunResult = {
      exitCode: next.exitCode ?? DEFAULT_EXIT_CODE,
      stderr: next.stderr ?? DEFAULT_STDERR,
      stdout: next.stdout ?? DEFAULT_STDOUT,
      timedOut: next.timedOut ?? DEFAULT_TIMED_OUT,
    };
    if (next.stdoutTruncated === true) {
      result.stdoutTruncated = true;
    }
    return Promise.resolve(result);
  }

  // Appends this invocation to `calls` — always, whether or not it goes on to match the next
  // Scripted response.
  #record(cmd: string, args: readonly string[], opts?: RunOpts): void {
    const call: FakeRunnerCall = { args, cmd };
    if (opts?.cwd !== undefined) {
      call.cwd = opts.cwd;
    }
    if (opts?.timeoutMs !== undefined) {
      call.timeoutMs = opts.timeoutMs;
    }
    this.calls.push(call);
  }

  // Pops and validates the next scripted response against the actual `full` command string (and
  // `cwd`, when scripted) — throws immediately on an empty queue or a mismatch, per the class doc
  // Comment above.
  #matchNext(full: string, opts?: RunOpts): FakeResult {
    const next = this.#queue.shift();
    if (next === undefined) {
      throw new Error(`FakeRunner: unexpected command with no scripted response left: "${full}"`);
    }
    if (!full.startsWith(next.cmdPrefix)) {
      throw new Error(
        `FakeRunner: expected next command to start with "${next.cmdPrefix}", got "${full}"`,
      );
    }
    if (next.cwd !== undefined && next.cwd !== opts?.cwd) {
      throw new Error(
        `FakeRunner: expected cwd "${next.cwd}" for "${next.cmdPrefix}", got "${opts?.cwd ?? '(none)'}"`,
      );
    }
    return next.result;
  }
}

export { FakeRunner };
