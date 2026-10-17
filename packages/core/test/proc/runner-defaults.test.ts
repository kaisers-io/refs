import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';

// What `SpawnRunner` adds to every child without being asked: the default `timeoutMs` the CLI
// configures from `REFS_GIT_TIMEOUT`, and `GIT_TERMINAL_PROMPT=0` unless the user set it. Real
// children, because both are about what actually reaches the process.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SHORT_MS = 200;
const LONG_MS = 10_000;
const HANG_SCRIPT = 'setTimeout(() => {}, 5000);';
const EXIT_AFTER_MS = 400;
const EXIT_AFTER_SHORT_SCRIPT = `setTimeout(() => {}, ${String(EXIT_AFTER_MS)});`;
const PRINT_PROMPT_SCRIPT =
  "process.stdout.write(JSON.stringify(process.env.GIT_TERMINAL_PROMPT ?? '<unset>'))";

const promptSeenWith = async (env: NodeJS.ProcessEnv): Promise<unknown> => {
  const result = await new SpawnRunner({ env }).run(process.execPath, ['-e', PRINT_PROMPT_SCRIPT]);
  return JSON.parse(result.stdout);
};

describe('the default timeout', SUITE_OPTS, () => {
  it('bounds a run that passes no timeout of its own', async () => {
    expect.hasAssertions();
    const runner = new SpawnRunner({ defaultTimeoutMs: SHORT_MS });
    const result = await runner.run(process.execPath, ['-e', HANG_SCRIPT]);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain(`timed out after ${String(SHORT_MS)}ms`);
  });

  it('gives way to a timeout the caller passes', async () => {
    expect.hasAssertions();
    const runner = new SpawnRunner({ defaultTimeoutMs: SHORT_MS });
    const result = await runner.run(process.execPath, ['-e', EXIT_AFTER_SHORT_SCRIPT], {
      timeoutMs: LONG_MS,
    });
    expect(result.timedOut).toBeUndefined();
    expect(result.exitCode).toBe(0);
  });
});

describe('the GIT_TERMINAL_PROMPT default', () => {
  it('reaches the child as 0 when the user did not set it', async () => {
    expect.hasAssertions();
    await expect(promptSeenWith({ PATH: process.env['PATH'] })).resolves.toBe('0');
  });

  it.each([['1'], ['0'], ['']])(
    'passes a value the user set (%j) through untouched',
    async (value) => {
      expect.hasAssertions();
      await expect(
        promptSeenWith({ GIT_TERMINAL_PROMPT: value, PATH: process.env['PATH'] }),
      ).resolves.toBe(value);
    },
  );
});
