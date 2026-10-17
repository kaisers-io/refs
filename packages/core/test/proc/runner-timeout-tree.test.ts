import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A timeout has to END the command, not only mark it. git runs its transport in descendants
// (`git remote-http`, `git-remote-http`, `ssh`) that inherit its stderr; signalling git alone left
// them holding the pipe, and the run waited for them. These build that shape with `sh` and `sleep`
// and assert the outcomes that matter: the run returns near its deadline, and the descendant is
// gone. POSIX only: the shape needs a forked descendant inheriting the pipe, which Windows pipes
// do not keep open (see runner.test.ts), and `taskkill /T` covers the tree there.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const TIMEOUT_MS = 300;
// What the descendant would otherwise keep the run waiting for.
const DESCENDANT_SECONDS = 30;
// A SIGTERM to the tree ends it at once; the bound leaves room for `ps` on a busy machine.
const TREE_KILL_BOUND_MS = 5000;
// An escaped process is only released at the SIGKILL escalation, 2s after the deadline.
const ESCALATION_BOUND_MS = 8000;
const POLL_MS = 50;
const POLL_ATTEMPTS = 40;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Whether `pid` has exited within the polling window; reaping by init can lag the signal. */
const exitsSoon = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < POLL_ATTEMPTS && isAlive(pid); attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- polling one process until it is gone
    await delay(POLL_MS);
  }
  return !isAlive(pid);
};

const pidFile = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-runner-tree-'));
  return join(dir, 'pid');
};

const readPid = async (path: string): Promise<number> => {
  const text = await readFile(path, 'utf8');
  return Number(text.trim());
};

/** Runs `script` under `sh` with the pid file as `$1`, timing the run. */
const timedRun = async (
  script: string,
  file: string,
): Promise<{ elapsedMs: number; timedOut: boolean | undefined }> => {
  const started = Date.now();
  const result = await new SpawnRunner().run('sh', ['-c', script, 'sh', file], {
    timeoutMs: TIMEOUT_MS,
  });
  return { elapsedMs: Date.now() - started, timedOut: result.timedOut };
};

describe.skipIf(process.platform === 'win32')(
  'a timeout ends the whole process tree',
  SUITE_OPTS,
  () => {
    it('kills a descendant that holds the inherited pipes, and returns near the deadline', async () => {
      expect.hasAssertions();
      const file = await pidFile();
      const script = `sleep ${String(DESCENDANT_SECONDS)} & echo $! > "$1"; wait`;
      const run = await timedRun(script, file);
      expect(run.elapsedMs).toBeLessThan(TREE_KILL_BOUND_MS);
      expect(run.timedOut).toBe(true);
      const descendant = await readPid(file);
      await expect(exitsSoon(descendant)).resolves.toBe(true);
    });

    it('still returns when a process escaped the tree but holds the pipes', async () => {
      expect.hasAssertions();
      const file = await pidFile();
      // The subshell exits at once, so the `sleep` it started is reparented before the deadline and
      // no tree walk from the direct child can find it.
      const script = `(sleep ${String(DESCENDANT_SECONDS)} & echo $! > "$1"); sleep ${String(DESCENDANT_SECONDS)}`;
      const run = await timedRun(script, file);
      const escaped = await readPid(file);
      const escapedWasAlive = isAlive(escaped);
      process.kill(escaped, 'SIGKILL');
      // The escalation released the pipes; it did not, and cannot, reach this process.
      expect(escapedWasAlive).toBe(true);
      expect(run.elapsedMs).toBeLessThan(ESCALATION_BOUND_MS);
      expect(run.timedOut).toBe(true);
    });
  },
);
