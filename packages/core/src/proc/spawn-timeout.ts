import type { Exec, TreeTarget } from './spawn-tree.ts';
import type { ChildProcess } from 'node:child_process';
import { signalTree } from './spawn-tree.ts';

// `timeoutMs` enforcement for `SpawnRunner` (runner.ts): SIGTERM to the child's whole process
// tree when the deadline expires, escalating to SIGKILL if anything in it ignores that.

// Grace period between the `SIGTERM` a `timeoutMs` expiry sends and the forced `SIGKILL`
// escalation — the same SIGTERM-then-SIGKILL-after-a-delay shape common process-execution
// libraries use. Long enough for `git clone` to remove the destination it half populated, which
// it does on SIGTERM and cannot do on SIGKILL.
const KILL_GRACE_MS = 2000;

type TimeoutHandle = {
  markedTimedOut: () => boolean;
  clear: () => void;
};

type TimeoutTarget = {
  child: ChildProcess;
  exec: Exec;
  timeoutMs: number | undefined;
};

const noopTimeout: TimeoutHandle = { clear: () => {}, markedTimedOut: () => false };

const treeOf = (target: TimeoutTarget): TreeTarget | undefined =>
  target.child.pid === undefined
    ? undefined
    : {
        exec: target.exec,
        pid: target.child.pid,
        platform: process.platform,
        rootAlive: () => target.child.exitCode === null && target.child.signalCode === null,
        seen: new Set(),
        systemRoot: process.env['SystemRoot'],
      };

// The last resort that makes `timeoutMs` a wall-clock bound: a process that escaped the tree walk
// (it daemonized, or `ps` could not see it) may still hold the child's stdout or stderr, and
// `close` waits for both. Destroying our ends lets `close` fire once the direct child has exited.
const releaseStdio = (child: ChildProcess): void => {
  child.stdout?.destroy();
  child.stderr?.destroy();
};

const terminate = async (child: ChildProcess, tree: TreeTarget | undefined): Promise<void> => {
  if (tree === undefined) {
    child.kill('SIGTERM');
    return;
  }
  await signalTree(tree, 'SIGTERM');
};

const escalate = async (child: ChildProcess, tree: TreeTarget | undefined): Promise<void> => {
  if (tree === undefined) {
    child.kill('SIGKILL');
  } else {
    await signalTree(tree, 'SIGKILL');
  }
  releaseStdio(child);
};

// Arms a tree-wide `SIGTERM` at `timeoutMs`, escalating to `SIGKILL` and releasing the stdio pipes
// after `KILL_GRACE_MS` — both timers are cleared as soon as the child's `close` event fires,
// whichever comes first (see `runner.ts#SpawnRunner.run`). `timeoutMs === undefined` arms nothing.
const armTimeout = (target: TimeoutTarget): TimeoutHandle => {
  if (target.timeoutMs === undefined) {
    return noopTimeout;
  }
  const { child } = target;
  const tree = treeOf(target);
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined = undefined;
  const termTimer = setTimeout(() => {
    timedOut = true;
    void terminate(child, tree);
    killTimer = setTimeout(() => {
      void escalate(child, tree);
    }, KILL_GRACE_MS);
  }, target.timeoutMs);
  return {
    clear: () => {
      clearTimeout(termTimer);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
    },
    markedTimedOut: () => timedOut,
  };
};

export { armTimeout };
