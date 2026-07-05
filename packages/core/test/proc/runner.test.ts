import { ExecaRunner, TIMEOUT_EXIT_CODE } from '../../src/proc/runner.ts';
import { access, mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Real `execa` integration suite for `ExecaRunner`'s `timeoutMs` option (never a mock — this is the
// one place proving `run()` actually kills a hung child rather than merely racing it). Fixes the
// review finding that a timed-out `ssh` probe kept running after `raceWithTimeout` gave up on it,
// which kept the whole short-lived CLI process (and, in this suite, the test process itself) alive
// long after doctor had already printed its results.

const TEST_TIMEOUT_MS = 30_000;
const SUITE_OPTS = { timeout: TEST_TIMEOUT_MS };
const SHORT_TIMEOUT_MS = 100;
const RESOLVE_MARGIN_MS = 2000;
const SLEEP_SECONDS = '5';
const CHILD_DELAY_SECONDS = '1';
const KILL_CHECK_DELAY_MS = 1500;

const runner = new ExecaRunner();

describe('timeoutMs (ExecaRunner)', SUITE_OPTS, () => {
  it('resolves quickly with a normalized timeout result instead of waiting out the child', async () => {
    expect.hasAssertions();
    const start = Date.now();

    const result = await runner.run('sleep', [SLEEP_SECONDS], { timeoutMs: SHORT_TIMEOUT_MS });

    expect(Date.now() - start).toBeLessThan(RESOLVE_MARGIN_MS);
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.stderr).toContain('timed out');
  });

  it('actually kills the child rather than leaving it to finish in the background', async () => {
    expect.hasAssertions();
    const dir = await mkdtemp(join(tmpdir(), 'refs-runner-timeout-'));
    const marker = join(dir, 'done');

    await runner.run('sh', ['-c', `sleep ${CHILD_DELAY_SECONDS} && touch ${marker}`], {
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    // The child needs ~1s to reach `touch`; it was killed at ~100ms. If it had survived instead
    // of actually being killed, `marker` would exist well within this margin — its absence is the
    // proof the process is dead, not merely lost the race.
    await delay(KILL_CHECK_DELAY_MS);

    await expect(access(marker)).rejects.toThrow(/ENOENT/u);
  });

  it('sets timedOut true when this run() was killed by its own timeoutMs', async () => {
    expect.hasAssertions();

    const result = await runner.run('sleep', [SLEEP_SECONDS], { timeoutMs: SHORT_TIMEOUT_MS });

    expect(result.timedOut).toBe(true);
  });

  it('leaves timedOut unset for a real child that genuinely exits 124 on its own', async () => {
    expect.hasAssertions();

    const result = await runner.run('sh', ['-c', `exit ${String(TIMEOUT_EXIT_CODE)}`]);

    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.timedOut).not.toBe(true);
  });
});
