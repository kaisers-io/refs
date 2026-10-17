import type { Exec, TreeTarget } from './spawn-tree.ts';
import { setTimeout as delay } from 'node:timers/promises';

// Whether a timed-out process tree has actually ended (spawn-timeout.ts).
//
// The direct child's `close` is not that answer. A descendant that ignores SIGTERM and has closed
// or redirected the stdio it inherited lets `close` fire as soon as the direct child dies, and
// keeps running. Measured on this branch before this file existed: a 300 ms timeout returned
// after 329 ms, and such a descendant was still alive and writing to a file 3.5 s later, because
// `close` also cancelled the SIGKILL escalation.
//
// "Known" is what the tree walk saw (spawn-tree.ts): the direct child and every descendant `ps`
// listed while the direct child was alive. A process that left the tree before it was listed is
// not known, and nothing here claims it ended. Windows has no descendant set (`taskkill /T` walks
// the tree itself), so only the direct child is confirmed there.

const SUCCESS_EXIT_CODE = 0;
const POLL_MS = 100;
const PS_STATE_ARGS = ['-A', '-o', 'pid=', '-o', 'stat='];
const PS_STATE_COLUMN_COUNT = 2;
const ZOMBIE_STATE = 'Z';

/** Whether `pid` names a process. EPERM means it exists but is not ours, which still counts:
 * nothing here can prove it is not the descendant it was. */
const pidExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The pids `ps` lists as zombies: exited, waiting to be reaped, and so already gone for every
 * purpose here. `undefined` when `ps` fails, which then confirms nothing. */
const zombies = async (exec: Exec): Promise<Set<number> | undefined> => {
  const result = await exec('ps', PS_STATE_ARGS);
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    return undefined;
  }
  const found = new Set<number>();
  for (const line of result.stdout.split('\n')) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length === PS_STATE_COLUMN_COUNT && fields[1]?.startsWith(ZOMBIE_STATE) === true) {
      found.add(Number(fields[0]));
    }
  }
  return found;
};

/** Whether any known process of the tree still runs. */
const anySurvivor = async (target: TreeTarget): Promise<boolean> => {
  if (target.rootAlive()) {
    return true;
  }
  const existing = [...target.seen].filter((pid) => pidExists(pid));
  if (existing.length === 0) {
    return false;
  }
  const exited = await zombies(target.exec);
  return exited === undefined || existing.some((pid) => !exited.has(pid));
};

/** Polls until no known process of the tree runs, for at most `boundMs`. Answers whether that
 * happened. */
const treeEnded = async (target: TreeTarget, boundMs: number): Promise<boolean> => {
  const deadline = Date.now() + boundMs;
  let surviving = await anySurvivor(target);
  while (surviving && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- polling one tree until it is gone
    await delay(POLL_MS);
    // eslint-disable-next-line no-await-in-loop -- polling one tree until it is gone
    surviving = await anySurvivor(target);
  }
  return !surviving;
};

export { treeEnded };
