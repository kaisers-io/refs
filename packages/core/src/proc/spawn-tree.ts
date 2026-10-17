import type { RunResult } from './runner.ts';

// Process-tree signalling for `timeoutMs` (spawn-timeout.ts).
//
// Signalling only the direct child does not end a timed-out git command. Measured with git 2.43
// against a server that accepts the connection and never answers: SIGTERM to `git clone` ends
// git, which removes its half-made destination, but `git remote-http` and `git-remote-http` live
// on, reparented, and still hold the stderr pipe they inherited. `close` waits for that pipe, so
// the run never returned and refs went on holding the per-ref lock. The tree is listed BEFORE
// anything is signalled: once the direct child dies its descendants are reparented and can no
// longer be found from its pid.
//
// It does not use a process group. A detached child gets a new session on POSIX, and a process
// with no controlling terminal cannot open `/dev/tty`, which is where ssh asks for a key
// passphrase and git asks for a password when a person has opted back in to prompts.

/** Runs one short helper command (`ps`, `taskkill`). Injected so this module starts nothing. */
type Exec = (cmd: string, args: readonly string[]) => Promise<RunResult>;

type TreeSignal = 'SIGTERM' | 'SIGKILL';

type TreeTarget = {
  exec: Exec;
  pid: number;
  platform: NodeJS.Platform;
  /** Every descendant seen so far, across calls. A descendant found at SIGTERM may have been
   * reparented by the time SIGKILL follows, and is then reachable only through this set. */
  seen: Set<number>;
};

const SUCCESS_EXIT_CODE = 0;
const PS_ARGS = ['-A', '-o', 'pid=', '-o', 'ppid='];
const PS_COLUMN_COUNT = 2;

/** `ps -o pid= -o ppid=` output as a parent → children map. Lines that are not two integers are
 * skipped: the output is read, never trusted to be well formed. */
const parseProcessTable = (text: string): Map<number, number[]> => {
  const children = new Map<number, number[]>();
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/u).map(Number);
    if (fields.length === PS_COLUMN_COUNT && fields.every((field) => Number.isSafeInteger(field))) {
      const [pid = 0, ppid = 0] = fields;
      children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    }
  }
  return children;
};

/** Every pid below `root` in `children`, breadth first. `root` itself is not included. */
const descendantsOf = (children: Map<number, number[]>, root: number): number[] => {
  const found: number[] = [];
  const queue = [root];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const child of children.get(pid) ?? []) {
      if (!found.includes(child) && child !== root) {
        found.push(child);
        queue.push(child);
      }
    }
  }
  return found;
};

/** The descendants `ps` can see right now; none when `ps` is missing or fails. A failure to look
 * leaves the direct child as the only target, which is what was signalled before this existed. */
const listDescendants = async (exec: Exec, pid: number): Promise<number[]> => {
  const result = await exec('ps', PS_ARGS);
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    return [];
  }
  return descendantsOf(parseProcessTable(result.stdout), pid);
};

const signalPid = (pid: number, signal: TreeSignal): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone, or not ours to signal: either way nothing is left to do for this pid.
  }
};

/** Signals `target.pid` and everything below it. On Windows `taskkill /T` walks the tree itself;
 * it has no polite form for a console process, so both signals become a forced kill there. */
const signalTree = async (target: TreeTarget, signal: TreeSignal): Promise<void> => {
  if (target.platform === 'win32') {
    await target.exec('taskkill', ['/PID', String(target.pid), '/T', '/F']);
    return;
  }
  for (const pid of await listDescendants(target.exec, target.pid)) {
    target.seen.add(pid);
  }
  signalPid(target.pid, signal);
  for (const pid of target.seen) {
    signalPid(pid, signal);
  }
};

export { descendantsOf, parseProcessTable, signalTree };
export type { Exec, TreeTarget };
