import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat, symlink } from 'node:fs/promises';
import type { RunResult } from '../../src/proc/runner.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The direct child's `close` is not the end of a timed-out tree. A descendant that ignores SIGTERM
// and has redirected the stdio it inherited lets `close` fire the moment the direct child dies.
// The run used to return then, ~300 ms in, cancelling the SIGKILL escalation on the way, and the
// descendant went on running and writing. These assert the outcome: once the run returns, the
// descendant is no longer running and its output has stopped. POSIX only, like
// runner-timeout-tree.test.ts.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const TIMEOUT_MS = 300;
const DESCENDANT_SECONDS = 30;
// Long enough for a live writer (one line every 100 ms) to have written several more lines.
const QUIET_WINDOW_MS = 1000;
// The SIGKILL escalation follows the deadline by 2 s; the rest is room for a busy machine.
const RETURN_BOUND_MS = 10_000;
const ZOMBIE_STATE = 'Z';

// The descendant ignores SIGTERM, points its stdio away from the inherited pipes, and appends to
// `$2` every 100 ms. The direct child (`sh`) dies on SIGTERM.
const TERM_RESISTANT = `(trap '' TERM; exec >/dev/null 2>&1; while :; do echo x >> "$2"; sleep 0.1; done) & echo $! > "$1"; sleep ${String(DESCENDANT_SECONDS)}`;

/** Whether `pid` still runs. A zombie has exited and only waits for init to reap it, which can
 * lag the kill, so it counts as not running; `ps` is how to tell the two apart. */
const isRunning = async (pid: number): Promise<boolean> => {
  const result = await new SpawnRunner().run('ps', ['-o', 'stat=', '-p', String(pid)]);
  const state = result.stdout.trim();
  return state !== '' && !state.startsWith(ZOMBIE_STATE);
};

const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-runner-survivor-'));

const sizeOf = async (path: string): Promise<number> => {
  const info = await stat(path);
  return info.size;
};

const readPid = async (path: string): Promise<number> => {
  const text = await readFile(path, 'utf8');
  return Number(text.trim());
};

type Observed = { elapsedMs: number; result: RunResult; running: boolean; grewBy: number };

/** Runs the TERM-resistant tree under a timeout and records what is left the moment it returns. */
const observeRun = async (): Promise<Observed> => {
  const dir = await scratch();
  const [pidFile, outFile] = [join(dir, 'pid'), join(dir, 'out')];
  const started = Date.now();
  const result = await new SpawnRunner().run('sh', ['-c', TERM_RESISTANT, 'sh', pidFile, outFile], {
    timeoutMs: TIMEOUT_MS,
  });
  const elapsedMs = Date.now() - started;
  const running = await isRunning(await readPid(pidFile));
  const sizeAtReturn = await sizeOf(outFile);
  await delay(QUIET_WINDOW_MS);
  const sizeAfter = await sizeOf(outFile);
  return { elapsedMs, grewBy: sizeAfter - sizeAtReturn, result, running };
};

describe.skipIf(process.platform === 'win32')(
  'a timeout waits for the tree, not for close',
  SUITE_OPTS,
  () => {
    it('ends a SIGTERM-resistant descendant that released the pipes before returning', async () => {
      expect.hasAssertions();
      const seen = await observeRun();
      expect.soft(seen.running).toBe(false);
      expect.soft(seen.grewBy).toBe(0);
      expect.soft(seen.result.timedOut).toBe(true);
      expect.soft(seen.result.cleanupUncertain).toBeUndefined();
      expect(seen.elapsedMs).toBeLessThan(RETURN_BOUND_MS);
    });

    it('reports cleanup as uncertain when the tree could not be listed', async () => {
      expect.hasAssertions();
      // A PATH that has `sleep` but no `ps`: the run itself works, the tree walk cannot. The direct
      // child is the only process, and it dies on SIGTERM; what is unknown is whether it was alone.
      const bin = await scratch();
      await symlink('/bin/sleep', join(bin, 'sleep'));
      const runner = new SpawnRunner({ env: { PATH: bin } });
      const result = await runner.run('sleep', [String(DESCENDANT_SECONDS)], {
        timeoutMs: TIMEOUT_MS,
      });
      expect.soft(result.timedOut).toBe(true);
      expect.soft(result.stderr).toContain('may still be running');
      expect(result.cleanupUncertain).toBe(true);
    });
  },
);
