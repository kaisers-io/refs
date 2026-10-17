import type { RunResult, Runner } from '@kaisers-io/refs-core';

// A `Runner` that records how many `run` calls were in flight at once. Calls are held, unanswered,
// until no new call has arrived for `QUIET_MS`, and then all answered together. So every caller
// that is ALLOWED to start does reach the runner before any of them finishes, even when each does
// some file-system work first: an unbounded fan-out shows its full width, and a capped one shows
// exactly its cap. Answers come from `respond`, keyed on the call, so the code under test still
// sees results it can tell apart and a test can check each one landed against the right item.

// Long enough to cover the lock and directory work `sync` does before its first git call on a busy
// machine; short enough that a batch of a few rounds stays well inside the test timeout.
const QUIET_MS = 100;

type PeakRunner = Runner & {
  calls: () => number;
  peak: () => number;
};

type Responder = (args: readonly string[], cwd: string | undefined) => Partial<RunResult>;

type Counters = { calls: number; inFlight: number; peak: number };

/** Holds callers until the runner has been quiet for `QUIET_MS`, then releases all of them. */
const createQuietGate = (): (() => Promise<void>) => {
  let held: (() => void)[] = [];
  let timer: NodeJS.Timeout | undefined = undefined;
  const releaseAll = (): void => {
    const waking = held;
    held = [];
    for (const wake of waking) {
      wake();
    }
  };
  return () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    held.push(resolve);
    clearTimeout(timer);
    timer = setTimeout(releaseAll, QUIET_MS);
    return promise;
  };
};

const createPeakRunner = (respond: Responder): PeakRunner => {
  const counters: Counters = { calls: 0, inFlight: 0, peak: 0 };
  const waitForQuiet = createQuietGate();
  const run = async (
    _cmd: string,
    args: readonly string[],
    opts?: { cwd?: string },
  ): Promise<RunResult> => {
    counters.calls += 1;
    counters.inFlight += 1;
    counters.peak = Math.max(counters.peak, counters.inFlight);
    await waitForQuiet();
    counters.inFlight -= 1;
    return { exitCode: 0, stderr: '', stdout: '', ...respond(args, opts?.cwd) };
  };
  return { calls: () => counters.calls, peak: () => counters.peak, run };
};

export { createPeakRunner };
export type { PeakRunner };
