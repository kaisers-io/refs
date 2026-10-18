import type { ChildProcess, spawn } from 'node:child_process';
import { win32 } from 'node:path';

// `timeoutMs` enforcement for `SpawnRunner` (runner.ts): stop the child AND the helpers it started
// when the deadline expires, escalating to SIGKILL if they ignore SIGTERM.
//
// Why the helpers too: git starts `git-remote-http`, `index-pack` or ssh on its own output pipes,
// and `run()` resolves on `close`, once every holder of those pipes is gone. A helper blocked on a
// server that never answers outlives a stopped git (measured: `git clone` from a loopback server
// that never replies leaves `git-remote-http` running, re-parented, holding stderr), so stopping
// git alone left `run()` — and the per-ref lock — waiting forever, deadline or not.
//
// - POSIX: a child with a deadline is spawned `detached`, leading its own process group, and the
//   signals go to that group. Only the group refs created is signalled, never anything else.
//   `detached` also starts a new session, so these git commands have no controlling terminal and
//   cannot prompt on it; refs already turns git's terminal prompt off (child-env.ts), and ssh then
//   uses its agent or SSH_ASKPASS. A child without a deadline is spawned exactly as before.
// - Windows: `taskkill /T /F` on the child's tree, while the child is still alive (taskkill finds
//   descendants through their live root); never on a root that already exited. taskkill is started from `%SystemRoot%\System32` by
//   absolute path, never looked up on PATH or in the working directory, which is a checkout. It is
//   started with the `spawn` runner.ts hands in: runner.ts stays the one module that imports a
//   process starter (spawn-surface.test.ts).

// Grace between the SIGTERM a deadline sends and the forced SIGKILL — short: every refs command
// is a short git/ssh invocation, never a daemon that needs time to flush state.
const KILL_GRACE_MS = 2000;
const IS_WINDOWS = process.platform === 'win32';
const ABSOLUTE_WINDOWS_DIR = /^[a-z]:[\\/]/iu;

type TimeoutHandle = {
  markedTimedOut: () => boolean;
  clear: () => void;
};

const noopTimeout: TimeoutHandle = { clear: () => {}, markedTimedOut: () => false };

// Children spawned as the leader of their own process group (POSIX, with a deadline).
const groupLeaders = new WeakSet<ChildProcess>();

/** Extra spawn options: a child with a deadline leads its own process group on POSIX. */
const deadlineSpawnOpts = (timeoutMs: number | undefined): { detached?: true } =>
  timeoutMs === undefined || IS_WINDOWS ? {} : { detached: true };

/** Records `child` as a group leader when it was spawned with `deadlineSpawnOpts`. */
const trackGroup = (child: ChildProcess, timeoutMs: number | undefined): void => {
  if (deadlineSpawnOpts(timeoutMs).detached === true) {
    groupLeaders.add(child);
  }
};

const killChild = (child: ChildProcess, signal: NodeJS.Signals): void => {
  try {
    child.kill(signal);
  } catch {
    // Already gone.
  }
};

/** Signals `child` and, when it leads its own group, every process in that group. */
const signalTree = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid === undefined || !groupLeaders.has(child)) {
    killChild(child, signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    killChild(child, signal);
  }
};

const taskkillPath = (env: NodeJS.ProcessEnv): string | undefined => {
  const root = env['SystemRoot'] ?? env['SYSTEMROOT'] ?? '';
  return ABSOLUTE_WINDOWS_DIR.test(root) ? win32.join(root, 'System32', 'taskkill.exe') : undefined;
};

/** Windows: `taskkill /T /F` on the child's tree; the plain kill when taskkill cannot run. */
type Start = typeof spawn;

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

// A root that already exited while a helper still holds its pipes: taskkill names the tree by the
// root's PID, which Windows may have handed to an unrelated process by now, and finds descendants
// only through a live root, so it would reach nothing refs started. Closing refs' ends of the pipes
// instead lets `run()` end at its deadline; the orphaned helper is left to its own timeout.
const releaseExitedRoot = (child: ChildProcess): void => {
  child.stdout?.destroy();
  child.stderr?.destroy();
};

const killWindowsTree = (child: ChildProcess, start: Start, env = process.env): void => {
  if (hasExited(child)) {
    releaseExitedRoot(child);
    return;
  }
  const taskkill = taskkillPath(env);
  if (child.pid === undefined || taskkill === undefined) {
    killChild(child, 'SIGTERM');
    return;
  }
  const killer = start(taskkill, ['/pid', String(child.pid), '/T', '/F'], {
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  killer.on('error', () => {
    killChild(child, 'SIGTERM');
  });
};

const stopTree = (child: ChildProcess, start: Start): void => {
  if (IS_WINDOWS) {
    killWindowsTree(child, start);
    return;
  }
  signalTree(child, 'SIGTERM');
};

// Arms the stop at `timeoutMs`, escalating to SIGKILL after `KILL_GRACE_MS` — both timers are
// cleared as soon as the child's `close` event fires (see `runner.ts#SpawnRunner.run`).
// `timeoutMs === undefined` arms nothing. `start` is runner.ts's `spawn`, for taskkill.
const armTimeout = (
  child: ChildProcess,
  timeoutMs: number | undefined,
  start: Start,
): TimeoutHandle => {
  if (timeoutMs === undefined) {
    return noopTimeout;
  }
  trackGroup(child, timeoutMs);
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined = undefined;
  const termTimer = setTimeout(() => {
    timedOut = true;
    stopTree(child, start);
    killTimer = setTimeout(() => {
      signalTree(child, 'SIGKILL');
    }, KILL_GRACE_MS);
  }, timeoutMs);
  return {
    clear: () => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
    },
    markedTimedOut: () => timedOut,
  };
};

export { armTimeout, deadlineSpawnOpts, killWindowsTree, signalTree, taskkillPath };
