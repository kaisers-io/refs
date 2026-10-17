import { assertGitHelpers, assertGitSearchPaths } from '../../src/proc/git-helper-policy.ts';
import { delimiter, join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import type { ConfigEntry } from '../../src/proc/git-config-graph.ts';
import { tmpdir } from 'node:os';

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'refs-helper-policy-'));
  onTestFinished(async () => {
    await rm(root, { force: true, recursive: true });
  });
  const sources = join(root, 'sources');
  await mkdir(sources);
  return { root, roots: [sources] };
};
const entry = (key: string, value: string | undefined): ConfigEntry => ({
  key,
  origin: 'command line:',
  value,
});
const REFUSAL = /use trusted external helpers/u;

describe('trusted executable search paths', () => {
  it.each(['', '.', './bin', '../tools'])(
    'refuses a relative or empty PATH entry %s',
    async (path) => {
      expect.hasAssertions();
      const setup = await fixture();
      await expect(
        assertGitSearchPaths({
          env: { PATH: [setup.root, path].join(delimiter) },
          roots: setup.roots,
        }),
      ).rejects.toThrow(REFUSAL);
    },
  );

  it('refuses a managed directory as PATH or GIT_EXEC_PATH', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    await expect(
      assertGitSearchPaths({
        env: { PATH: join(setup.root, 'sources', 'repo') },
        roots: setup.roots,
      }),
    ).rejects.toThrow(REFUSAL);
    await expect(
      assertGitSearchPaths({ env: { GIT_EXEC_PATH: setup.roots[0] }, roots: setup.roots }),
    ).rejects.toThrow(REFUSAL);
  });

  it('keeps absolute external paths and an absent PATH usable', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    await expect(assertGitSearchPaths({ env: {}, roots: setup.roots })).resolves.toBeUndefined();
    await expect(
      assertGitSearchPaths({ env: { PATH: setup.root }, roots: setup.roots }),
    ).resolves.toBeUndefined();
  });
});

const REFUSED_COMMANDS = [
  '!./helper',
  '!node ../helper.mjs',
  'ssh -F config/ssh',
  'ssh -F config',
  'ssh -Fconfig',
  'ssh -o ProxyCommand=helper',
  'ssh -oKnownHostsCommand=helper',
  '!true;python script.py',
  '!true&&source script',
  '!py"thon" script.py',
  '!echo $(cat script)',
  '!sh "$PWD/helper"',
  '/bin/sh tracked.sh',
  'python script.py',
  'cmd /c script.cmd',
  'cmd.exe /C script.cmd',
  '!eval "python script.py"',
  '!source tracked.sh',
];

describe('identifiable checkout-relative authentication commands', () => {
  it.each(REFUSED_COMMANDS)('refuses %s', async (command) => {
    expect.hasAssertions();
    const setup = await fixture();
    await expect(
      assertGitHelpers([entry('credential.helper', command)], { env: {}, roots: setup.roots }),
    ).rejects.toThrow(REFUSAL);
  });

  it('refuses absolute helper paths into managed content, including direct askpass', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    const script = join(setup.root, 'sources', 'repo', 'helper');
    await expect(
      assertGitHelpers([entry('core.sshcommand', script)], { env: {}, roots: setup.roots }),
    ).rejects.toThrow(REFUSAL);
    await expect(
      assertGitHelpers([], { env: { GIT_ASKPASS: script }, roots: setup.roots }),
    ).rejects.toThrow(REFUSAL);
  });

  it('preserves common helpers, absolute paths with spaces, and external SSH config', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    const sshConfig = join(setup.root, 'ssh-config');
    await expect(
      assertGitHelpers(
        [
          entry('credential.helper', '!gh auth git-credential'),
          entry('core.sshcommand', 'ssh -F ~/.ssh/config'),
          entry('core.sshcommand', `ssh -F${sshConfig}`),
        ],
        {
          env: { GIT_ASKPASS: join(setup.root, 'askpass with spaces'), HOME: setup.root },
          roots: setup.roots,
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe.skipIf(process.platform === 'win32')('helper path aliases', () => {
  it('does not trust a symlink that resolves into a reference', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    const alias = join(setup.root, 'alias');
    await symlink(setup.root, alias);
    await expect(
      assertGitHelpers([], {
        env: { GIT_SSH: join(alias, 'sources', 'helper') },
        roots: setup.roots,
      }),
    ).rejects.toThrow(REFUSAL);
  });
});

describe('implicit Git for Windows executable inputs', () => {
  it('refuses the implicit home/bin search root even with global config overridden', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    await expect(
      assertGitSearchPaths(
        {
          env: { GIT_CONFIG_GLOBAL: setup.root, HOME: setup.roots[0] },
          roots: setup.roots,
        },
        'win32',
      ),
    ).rejects.toThrow(REFUSAL);
  });

  it('checks the Windows retry helper path', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    await expect(
      assertGitHelpers([], {
        env: { GIT_ASK_YESNO: './tracked-retry-helper' },
        roots: setup.roots,
      }),
    ).rejects.toThrow(REFUSAL);
  });
});
