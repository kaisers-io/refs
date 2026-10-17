import { describe, expect, it, vi } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { activeChildren } from '../../src/proc/spawn-cleanup.ts';
import { managedHooksFixture } from '../helpers/managed-hooks-fixture.ts';
import { once } from 'node:events';
import { readGitConfigGraph } from '../../src/proc/git-config-graph.ts';
import { resolveGitExecutable } from '../../src/proc/git-executable.ts';
import { terminateProcessTree } from '../../src/proc/process-tree.ts';
import { withHooksPath } from '../../src/proc/git-policy.ts';

vi.mock(import('../../src/proc/git-config-graph.ts'), () => ({
  readGitConfigGraph: vi.fn<typeof readGitConfigGraph>(),
}));
vi.mock(import('../../src/proc/git-executable.ts'), () => ({
  resolveGitExecutable: vi.fn<typeof resolveGitExecutable>(),
}));
vi.mock(import('../../src/proc/process-tree.ts'), async (original) => ({
  ...(await original()),
  terminateProcessTree: vi.fn<typeof terminateProcessTree>(),
}));
const DEADLINE_MS = 50;
const managedHooks = managedHooksFixture();

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

const failedInventory = (): void => {
  vi.mocked(resolveGitExecutable).mockResolvedValue(process.execPath);
  vi.mocked(terminateProcessTree).mockResolvedValue('fixture tree termination is unconfirmed');
  vi.mocked(readGitConfigGraph).mockImplementation(async (run) => {
    await run(['-e', 'setTimeout(() => {}, 30000)']);
    throw new Error('fixture inventory refusal');
  });
};

describe('termination uncertainty during Git safety inventory', () => {
  it('survives inventory error normalization and hooks-path wrappers', async () => {
    expect.hasAssertions();
    failedInventory();
    const runner = withHooksPath(new SpawnRunner(), managedHooks.hooksDir);
    try {
      const result = await runner.run('git', ['status'], { timeoutMs: DEADLINE_MS });
      expect(result).toMatchObject({ terminationFailed: true, timedOut: true });
      expect(runner.terminationFailed).toBe(true);
      await expect(runner.run(process.execPath, ['-e', 'process.exit(0)'])).resolves.toMatchObject({
        exitCode: 124,
        terminationFailed: true,
      });
    } finally {
      await stopFixture();
    }
  });
});
