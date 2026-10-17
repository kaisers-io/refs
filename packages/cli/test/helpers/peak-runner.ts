import type { RunResult, Runner } from '@kaisers-io/refs-core';

// A `Runner` that records how many `run` calls were in flight at once. Calls are held, unanswered,
// behind a barrier that opens only once the expected number of callers has arrived: `width` of
// them, or every call still to come when fewer than that remain out of `total`. A capped fan-out
// therefore shows exactly its cap however late any one allowed caller starts, because nothing is
// answered until the last of them is there. Answers come from `respond`, keyed on the call, so the
// code under test still sees results it can tell apart and a test can check each one landed
// against the right item.
//
// Two bounded waits keep the barrier honest in both directions:
// - Once the barrier is full it stays shut for `GRACE_MS` more, so callers beyond the cap that
//   are already on their way are counted. A capped fan-out cannot produce one, so this wait never
//   changes its peak; it only gives an unbounded one the room to show its width.
// - If the barrier never fills, because fewer callers than expected could start, everyone is
//   released after `STALL_MS` and `peak()` throws, naming how many arrived. That is a capped
//   fan-out narrower than expected, reported as such rather than as a timeout.

const GRACE_MS = 50;
// Far above the lock and directory work `sync` does before its first git call on a busy machine,
// and well inside vitest's per-test timeout.
const STALL_MS = 2000;

type PeakRunner = Runner & {
  calls: () => number;
  peak: () => number;
};

type Responder = (args: readonly string[], cwd: string | undefined) => Partial<RunResult>;

type PeakRunnerOptions = {
  respond: Responder;
  // Every `run` call the code under test will make.
  total: number;
  // How many calls should be in flight at once.
  width: number;
};

type Barrier = {
  held: (() => void)[];
  released: number;
  stall: string | undefined;
  timer: NodeJS.Timeout | undefined;
};

/** Wakes every held caller, the most recent first. Last in, first out: completion order is then
 * the reverse of start order, so a caller that collected results as they finished, instead of by
 * input position, would misattribute them. */
const releaseAll = (barrier: Barrier): void => {
  const waking = barrier.held.toReversed();
  barrier.held = [];
  barrier.released += waking.length;
  clearTimeout(barrier.timer);
  barrier.timer = undefined;
  for (const wake of waking) {
    wake();
  }
};

const createBarrier = ({
  total,
  width,
}: PeakRunnerOptions): { barrier: Barrier; wait: () => Promise<void> } => {
  const barrier: Barrier = { held: [], released: 0, stall: undefined, timer: undefined };
  const onStall = (expected: number): void => {
    barrier.stall ??= `only ${barrier.held.length} of ${expected} expected callers arrived`;
    releaseAll(barrier);
  };
  const wait = (): Promise<void> => {
    // The verdict is in after one stall; holding later rounds would only add a stall each.
    if (barrier.stall !== undefined) {
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    barrier.held.push(resolve);
    const expected = Math.min(width, total - barrier.released);
    clearTimeout(barrier.timer);
    barrier.timer =
      barrier.held.length >= expected
        ? setTimeout(releaseAll, GRACE_MS, barrier)
        : setTimeout(onStall, STALL_MS, expected);
    return promise;
  };
  return { barrier, wait };
};

const createPeakRunner = (options: PeakRunnerOptions): PeakRunner => {
  const counters = { calls: 0, inFlight: 0, peak: 0 };
  const { barrier, wait } = createBarrier(options);
  const run = async (
    _cmd: string,
    args: readonly string[],
    opts?: { cwd?: string },
  ): Promise<RunResult> => {
    counters.calls += 1;
    counters.inFlight += 1;
    counters.peak = Math.max(counters.peak, counters.inFlight);
    await wait();
    counters.inFlight -= 1;
    return { exitCode: 0, stderr: '', stdout: '', ...options.respond(args, opts?.cwd) };
  };
  const peak = (): number => {
    if (barrier.stall !== undefined) {
      throw new Error(`PeakRunner barrier stalled: ${barrier.stall}`);
    }
    return counters.peak;
  };
  return { calls: () => counters.calls, peak, run };
};

export { createPeakRunner };
export type { PeakRunner, PeakRunnerOptions };
