import type { ConfigEntry, GitConfigRun } from '../../src/proc/git-config-graph.ts';
import { describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { prepareGitCommand } from '../../src/proc/git-policy.ts';
import { readGitConfigGraph } from '../../src/proc/git-config-graph.ts';

vi.mock(import('../../src/proc/git-config-graph.ts'), () => ({
  readGitConfigGraph: vi.fn<typeof readGitConfigGraph>(),
}));
const inventory = vi.mocked(readGitConfigGraph);
const run = vi.fn<GitConfigRun>();
const INVALID_LENGTH = 8193;
const entry = (key: string, value: string | undefined = 'fixture'): ConfigEntry => ({
  key,
  origin: 'command line:',
  value,
});

const inspect = () => prepareGitCommand(run, { args: ['status'] });

const expectedSetting = (key: string, value: string): string =>
  key.includes('=')
    ? `--config-env=${key}=REFS_GIT_POLICY_${value.toUpperCase()}`
    : `${key}=${value}`;

describe('per-label execution controls', () => {
  it.each([
    '',
    'ordinary',
    'dot.label',
    'with=equals',
    'line\rseparator',
    'paragraph\u2029separator',
  ])('covers the exact subsection name %s', async (label) => {
    expect.hasAssertions();
    inventory.mockResolvedValue([entry(`hook.${label}.command`), entry(`filter.${label}.smudge`)]);
    const result = await inspect();
    const hook = expectedSetting(`hook.${label}.enabled`, 'false');
    const filter = expectedSetting(`filter.${label}.required`, 'true');
    expect(result.args).toContain(hook);
    expect(result.args).toContain(filter);
    expect(result.env['REFS_GIT_POLICY_FALSE']).toBe('false');
    expect(result.env['REFS_GIT_POLICY_EMPTY']).toBe('');
  });

  it('refuses oversized override sets instead of silently dropping labels', async () => {
    expect.hasAssertions();
    inventory.mockResolvedValue([entry(`hook.${'x'.repeat(INVALID_LENGTH)}.command`)]);
    await expect(inspect()).rejects.toThrow('too large to neutralize safely');
  });

  it('keeps ordinary auth settings and refuses unneutralizable execution settings', async () => {
    expect.hasAssertions();
    inventory.mockResolvedValue([entry('credential.helper'), entry('core.sshcommand')]);
    await expect(inspect()).resolves.toMatchObject({ args: expect.arrayContaining(['status']) });
    inventory.mockResolvedValue([entry('remote.origin.uploadpack')]);
    await expect(inspect()).rejects.toThrow('unsupported upload-pack');
  });
});

describe('configuration inventory context', () => {
  it('passes the managed content and prospective clone boundaries into inventory', async () => {
    expect.hasAssertions();
    inventory.mockResolvedValue([entry('core.filemode', '')]);
    const home = resolve('fixture-home');
    const cwd = resolve('fixture-caller');
    const destination = join(home, 'sources', 'repo');
    await prepareGitCommand(run, {
      args: ['clone', '--', 'https://example.invalid/repo', destination],
      cwd,
      hooksPath: join(home, 'hooks'),
    });
    expect(inventory).toHaveBeenLastCalledWith(run, {
      cwd,
      env: expect.any(Object),
      protectedRoots: [join(home, 'sources'), destination],
    });
  });
});

describe('git for Windows child environment policy', () => {
  it.each([
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'REFS_GIT_POLICY_FALSE',
    'GIT_ALLOW_PROTOCOL',
  ])('refuses removal of %s before spawning Git children', async (value) => {
    expect.hasAssertions();
    inventory.mockResolvedValue([entry('core.unsetenvvars', value)]);
    await expect(inspect()).rejects.toThrow('environment stripping');
  });

  it.each(['', 'PERL5LIB'])(
    'preserves the safe default or empty unsetenvvars=%s',
    async (value) => {
      expect.hasAssertions();
      inventory.mockResolvedValue([entry('core.unsetenvvars', value)]);
      await expect(inspect()).resolves.toMatchObject({ args: expect.arrayContaining(['status']) });
    },
  );
});
