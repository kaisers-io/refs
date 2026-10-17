import { DEFAULT_GIT_TIMEOUT_MS, gitTimeout } from '../../src/proc/git-timeout.ts';
import { describe, expect, it, vi } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';

const EXPLICIT_MS = 1234;
const CONFIGURED_MS = 4567;
const withDeadline = async (
  value: string | undefined,
  exercise: () => void | Promise<void>,
): Promise<void> => {
  vi.stubEnv('REFS_GIT_TIMEOUT_MS', value);
  try {
    await exercise();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe('git deadlines', () => {
  it('defaults every Git command to ten minutes while leaving other programs alone', async () => {
    expect.hasAssertions();
    const absent = process.env['REFS_TEST_NONEXISTENT'];
    await withDeadline(absent, () => {
      expect(gitTimeout('git')).toBe(DEFAULT_GIT_TIMEOUT_MS);
      expect(gitTimeout('ssh')).toBeUndefined();
    });
  });

  it('accepts configuration and explicit per-operation deadlines', async () => {
    expect.hasAssertions();
    await withDeadline(String(CONFIGURED_MS), () => {
      expect(gitTimeout('git')).toBe(CONFIGURED_MS);
      expect(gitTimeout('git', EXPLICIT_MS)).toBe(EXPLICIT_MS);
    });
    await withDeadline('0', () => {
      expect(gitTimeout('git')).toBeUndefined();
    });
  });

  it.each(['', '-1', '1.5', 'Infinity', '2147483648', 'junk'])(
    'rejects invalid configuration %j without spawning or throwing from the runner',
    async (value) => {
      expect.hasAssertions();
      await withDeadline(value, async () => {
        const result = await new SpawnRunner().run('git', ['--version']);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('REFS_GIT_TIMEOUT_MS must be an integer');
      });
    },
  );
});
