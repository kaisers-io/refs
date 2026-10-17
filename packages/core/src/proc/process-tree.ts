import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { win32 } from 'node:path';

const KILL_GRACE_MS = 2000;
const POLL_MS = 25;
const TASKKILL_TIMEOUT_MS = 5000;
// Never resolve this utility from cwd or PATH: a checkout can contain taskkill.exe.
const taskkillPath = (): string | undefined => {
  const root = process.env['SystemRoot'];
  return root !== undefined && /^[a-z]:[\\/]/iu.test(root)
    ? win32.join(root, 'System32', 'taskkill.exe')
    : undefined;
};
const taskkillArgs = (pid: number): string[] => ['/pid', String(pid), '/T', '/F'];

// SpawnRunner creates a separate POSIX process group, so negative PID targets only its own
// child and descendants, including helpers that retain the pipes after Git itself exits.
const signalGroup = (child: ChildProcess, signal: NodeJS.Signals | 0): boolean => {
  try {
    if (child.pid === undefined) {
      return child.kill(signal);
    }
    return process.kill(-child.pid, signal);
  } catch {
    return false;
  }
};

const WINDOWS_UNCONFIRMED = 'refs: could not confirm Windows subprocess tree termination';
const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const runTaskkill = async (pid: number, command: string): Promise<string | undefined> => {
  try {
    const killer = spawn(command, taskkillArgs(pid), {
      killSignal: 'SIGKILL',
      shell: false,
      stdio: 'ignore',
      timeout: TASKKILL_TIMEOUT_MS,
    });
    const [code] = await once(killer, 'close');
    return code === 0 && !killer.killed
      ? undefined
      : `${WINDOWS_UNCONFIRMED}: taskkill failed or timed out`;
  } catch {
    return `${WINDOWS_UNCONFIRMED}: taskkill could not run`;
  }
};

// taskkill cannot reliably discover descendants after their root has exited. Never target that
// stale PID: report uncertainty, preserve the checkout, and let the caller quarantine it.
const killWindowsTree = async (child: ChildProcess): Promise<string | undefined> => {
  if (child.pid === undefined) {
    return;
  }
  if (hasExited(child)) {
    return `${WINDOWS_UNCONFIRMED}: direct child already exited`;
  }
  const command = taskkillPath();
  if (command === undefined) {
    return `${WINDOWS_UNCONFIRMED}: absolute SystemRoot is unavailable`;
  }
  return await runTaskkill(child.pid, command);
};

const terminateProcessTree = async (
  child: ChildProcess,
  platform = process.platform,
): Promise<string | undefined> => {
  if (platform === 'win32') {
    return killWindowsTree(child);
  }
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + KILL_GRACE_MS;
  while (signalGroup(child, 0) && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- wait for this process group to stop writing
    await delay(POLL_MS);
  }
  signalGroup(child, 'SIGKILL');
  return undefined;
};

// `exit` cannot await asynchronous work. taskkill /T /F must finish synchronously here;
// unlike execSync this fixed argv call has no shell and accepts no repository-controlled text.
const killProcessTreeSync = (child: ChildProcess): void => {
  if (process.platform !== 'win32' || child.pid === undefined) {
    signalGroup(child, 'SIGKILL');
    return;
  }
  if (hasExited(child)) {
    return;
  }
  const command = taskkillPath();
  if (command === undefined) {
    return;
  }
  // eslint-disable-next-line node/no-sync -- process exit cannot wait for an async tree kill
  spawnSync(command, taskkillArgs(child.pid), {
    shell: false,
    stdio: 'ignore',
    timeout: TASKKILL_TIMEOUT_MS,
  });
};

export { killProcessTreeSync, terminateProcessTree };
