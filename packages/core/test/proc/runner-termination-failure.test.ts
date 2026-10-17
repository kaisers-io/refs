import { describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../../src/proc/runner.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { activeChildren } from '../../src/proc/spawn-cleanup.ts';
import { once } from 'node:events';
import { terminateProcessTree } from '../../src/proc/process-tree.ts';

vi.mock(import('../../src/proc/process-tree.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  terminateProcessTree: vi.fn<typeof terminateProcessTree>(),
}));
const DEADLINE_MS = 50;
const MAX_MS = 2000;

const stopFixture = async (): Promise<void> => {
  await Promise.all(
    [...activeChildren].map(async (child) => {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
      activeChildren.delete(child);
    }),
  );
};

const expectRefusesCommands = async (runner: SpawnRunner): Promise<void> => {
  expect(runner.terminationFailed).toBe(true);
  await expect(runner.run(process.execPath, ['-e', 'process.exit(0)'])).resolves.toMatchObject({
    exitCode: 124,
    terminationFailed: true,
  });
};

const expectDeadlineContext = (result: RunResult): void => {
  expect(result).toMatchObject({
    exitCode: 124,
    stdout: '',
    terminationFailed: true,
    timedOut: true,
  });
  expect(result.stderr).toBe(
    'refs: could not confirm Windows subprocess tree termination: taskkill failed or timed out\n' +
      `refs: command timed out after ${String(DEADLINE_MS)}ms`,
  );
};

describe('unconfirmed subprocess termination', () => {
  it('returns a bounded explicit failure and refuses subsequent commands in the same runner', async () => {
    expect.hasAssertions();
    vi.mocked(terminateProcessTree).mockResolvedValue(
      'refs: could not confirm Windows subprocess tree termination: taskkill failed or timed out',
    );
    const runner = new SpawnRunner();
    const started = Date.now();
    try {
      const result = await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        timeoutMs: DEADLINE_MS,
      });
      expectDeadlineContext(result);
      expect(Date.now() - started).toBeLessThan(MAX_MS);
      await expectRefusesCommands(runner);
    } finally {
      await stopFixture();
    }
  });
});
