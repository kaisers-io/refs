import type { ChildProcess } from 'node:child_process';

// `timeoutMs` escalation for `SpawnRunner` — split out of `runner.ts` purely to keep that file
// under the repo's 300-line oxlint cap.

// Grace period between the `SIGTERM` a `timeoutMs` expiry sends and the forced `SIGKILL`
// escalation if the child ignores it — the same SIGTERM-then-SIGKILL-after-a-delay shape common
// process-execution libraries use (shorter here: every `refs` command is a short git/ssh
// invocation, never a long-running daemon that might need time to flush state on `SIGTERM`).
const KILL_GRACE_MS = 2000;

interface TimeoutHandle {
  markedTimedOut: () => boolean;
  clear: () => void;
}

const noopTimeout: TimeoutHandle = { clear: () => {}, markedTimedOut: () => false };

// Arms a `SIGTERM` at `timeoutMs`, escalating to `SIGKILL` after `KILL_GRACE_MS` if the child is
// still alive — both timers are cleared as soon as the child's `close` event fires, whichever
// comes first (see `runner.ts#SpawnRunner.run`). `timeoutMs === undefined` arms nothing. Both
// signals target only the DIRECT child, never its whole process tree: a descendant it forked that
// inherited the stdio pipes can keep them open (delaying `close`) after the child itself is dead —
// empirically verified to be the exact kill scope of the previous runner, not a regression.
const armTimeout = (child: ChildProcess, timeoutMs: number | undefined): TimeoutHandle => {
  if (timeoutMs === undefined) {
    return noopTimeout;
  }
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined = undefined;
  const termTimer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, KILL_GRACE_MS);
  }, timeoutMs);
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
export type { TimeoutHandle };
