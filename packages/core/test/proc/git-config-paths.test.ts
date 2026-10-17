import { configPaths, includePath, sameConfigPath } from '../../src/proc/git-config-paths.ts';
import { describe, expect, it, vi } from 'vitest';
import type { GitConfigRun } from '../../src/proc/git-config-records.ts';

const paths = { cwd: '/synthetic', metadata: [], protectedRoots: [] };
const context = { cwd: '/synthetic', env: {}, protectedRoots: [] };
const FAILURE = 'Git configuration cannot be safely inventoried';
const answer = (stdout: string) => ({ exitCode: 0, stderr: '', stdout });

describe('safe repository discovery', () => {
  it.each(['relative\n', '/absolute-without-delimiter'])(
    'rejects malformed path output %j',
    async (output) => {
      expect.hasAssertions();
      const run = vi.fn<GitConfigRun>().mockResolvedValue(answer(output));
      await expect(configPaths(run, context)).rejects.toThrow(FAILURE);
    },
  );

  it.each([
    { exitCode: 1, stderr: 'unexpected failure', stdout: '' },
    { exitCode: 1, stderr: 'fatal: not a git repository', stdout: '', timedOut: true },
    {
      exitCode: 1,
      stderr: 'fatal: not a git repository',
      stdout: '',
      stdoutTruncated: true as const,
    },
  ])('rejects inconclusive repository discovery', async (result) => {
    expect.hasAssertions();
    const run = vi.fn<GitConfigRun>().mockResolvedValue(result);
    await expect(configPaths(run, context)).rejects.toThrow(FAILURE);
  });
});

describe('safe include path expansion', () => {
  it.each(['', '\0', 'first\0second\0'])(
    'rejects incomplete or ambiguous expanded paths %j',
    async (output) => {
      expect.hasAssertions();
      const run = vi.fn<GitConfigRun>().mockResolvedValue(answer(output));
      await expect(
        includePath(run, { key: 'include.path', origin: 'file:/config', value: '' }, paths),
      ).rejects.toThrow(FAILURE);
    },
  );

  it('rejects a valueless include and a relative command-scope include', async () => {
    expect.hasAssertions();
    const run = vi.fn<GitConfigRun>().mockResolvedValue(answer('relative\0'));
    await expect(
      includePath(run, { key: 'include.path', origin: 'file:/config', value: undefined }, paths),
    ).rejects.toThrow(FAILURE);
    expect(run).not.toHaveBeenCalled();
    await expect(
      includePath(run, { key: 'include.path', origin: 'command line:', value: 'relative' }, paths),
    ).rejects.toThrow(FAILURE);
  });
});

describe('metadata path identity', () => {
  it('accepts Git for Windows slash and casing conventions without accepting redirects', () => {
    expect.hasAssertions();
    expect(sameConfigPath('C:/Repo/.git/config', String.raw`c:\Repo\.git\config`, 'win32')).toBe(
      true,
    );
    expect(sameConfigPath('C:/Repo/.git/config', 'C:/Repo/tracked-config', 'win32')).toBe(false);
    expect(sameConfigPath('/repo/.git/config', '/repo/tracked-config', 'linux')).toBe(false);
  });
});
