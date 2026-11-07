// The `Runner` contract (runner.ts): the one process-execution seam production and test code share.

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  // Present-and-`true` only on a timed-out result whose process tree could not be confirmed ended
  // (spawn-confirm.ts): something the command started may still be running and writing. A caller
  // must then not treat what the command was writing to as abandoned — not remove it, not reuse
  // it. Never an explicit `false`.
  cleanupUncertain?: true;
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

export type { Runner, RunOpts, RunResult };
