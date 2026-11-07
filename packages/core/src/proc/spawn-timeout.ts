import type { Exec, TreeTarget } from './spawn-tree.ts';
import type { ChildProcess } from 'node:child_process';
import type { RunResult } from './runner.ts';
import { appendNote } from './spawn-collector.ts';
import { signalTree } from './spawn-tree.ts';
import { treeEnded } from './spawn-confirm.ts';

// `timeoutMs` enforcement for `SpawnRunner` (runner.ts): SIGTERM to the child's whole process
// tree when the deadline expires, escalating to SIGKILL if anything in it ignores that, and
// reporting whether the tree was then seen gone.

// Grace period between the `SIGTERM` a `timeoutMs` expiry sends and the forced `SIGKILL`
// escalation — the same SIGTERM-then-SIGKILL-after-a-delay shape common process-execution
// libraries use. Long enough for `git clone` to remove the destination it half populated, which
// it does on SIGTERM and cannot do on SIGKILL.
const KILL_GRACE_MS = 2000;

// How long the tree gets to be seen gone after the SIGKILL. SIGKILL cannot be caught, so this only
// covers reaping and a process stuck in an uninterruptible wait.
const CONFIRM_AFTER_KILL_MS = 1000;

type TimeoutHandle = {
  markedTimedOut: () => boolean;
  /** Called once the child's `close` has fired. Before the deadline it disarms everything and
   * answers `true`. After it, it waits for the escalation to finish and answers whether every
   * known process of the tree was seen gone (spawn-confirm.ts). */
  settle: () => Promise<boolean>;
};

type TimeoutTarget = {
  child: ChildProcess;
  exec: Exec;
  timeoutMs: number | undefined;
};

const noopTimeout: TimeoutHandle = {
  markedTimedOut: () => false,
  settle: () => Promise.resolve(true),
};

const treeOf = (target: TimeoutTarget, pid: number): TreeTarget => ({
  exec: target.exec,
  pid,
  platform: process.platform,
  rootAlive: () => target.child.exitCode === null && target.child.signalCode === null,
  seen: new Set(),
  systemRoot: process.env['SystemRoot'],
});

// The last resort that makes `timeoutMs` a wall-clock bound: a process that escaped the tree walk
// (it daemonized, or `ps` could not see it) may still hold the child's stdout or stderr, and
// `close` waits for both. Destroying our ends lets `close` fire once the direct child has exited.
const releaseStdio = (child: ChildProcess): void => {
  child.stdout?.destroy();
  child.stderr?.destroy();
};

// SIGTERM to the tree, then SIGKILL to whatever of it is still running after `KILL_GRACE_MS`.
// Runs to its end whether or not the direct child's `close` fired in between: that event says
// nothing about descendants that no longer hold its pipes. Answers whether the tree was confirmed
// ended; a failed `ps` listing means it was not.
const enforce = async (tree: TreeTarget): Promise<boolean> => {
  await signalTree(tree, 'SIGTERM');
  let ended = await treeEnded(tree, KILL_GRACE_MS);
  if (!ended) {
    await signalTree(tree, 'SIGKILL');
    ended = await treeEnded(tree, CONFIRM_AFTER_KILL_MS);
  }
  return ended && tree.listFailed !== true;
};

// Arms a tree-wide `SIGTERM` at `timeoutMs` (see `enforce`), and releases the stdio pipes
// `KILL_GRACE_MS` later if `close` has not fired by then. `settle` is what `runner.ts` awaits
// after `close`. `timeoutMs === undefined`, or a child that never started, arms nothing.
const armTimeout = (target: TimeoutTarget): TimeoutHandle => {
  const { child } = target;
  if (target.timeoutMs === undefined || child.pid === undefined) {
    return noopTimeout;
  }
  const tree = treeOf(target, child.pid);
  let enforcement: Promise<boolean> | undefined = undefined;
  let releaseTimer: NodeJS.Timeout | undefined = undefined;
  const termTimer = setTimeout(() => {
    enforcement = enforce(tree);
    releaseTimer = setTimeout(() => {
      releaseStdio(child);
    }, KILL_GRACE_MS);
  }, target.timeoutMs);
  return {
    markedTimedOut: () => enforcement !== undefined,
    settle: async () => {
      clearTimeout(termTimer);
      clearTimeout(releaseTimer);
      return (await enforcement) ?? true;
    },
  };
};

const UNCERTAIN_NOTE = 'refs: processes the command started may still be running';

/** A timed-out `result` as published when `settle` answered `treeEnded`: flagged, with a note,
 * when the tree was not confirmed ended. */
const withCleanupUncertainty = (result: RunResult, ended: boolean): RunResult =>
  ended
    ? result
    : { ...result, cleanupUncertain: true, stderr: appendNote(result.stderr, UNCERTAIN_NOTE) };

export { armTimeout, withCleanupUncertainty };
