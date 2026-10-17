import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { resolveGitExecutable } from '../../src/proc/git-executable.ts';
import { tmpdir } from 'node:os';

const EXECUTABLE = 0o700;
const GIT_NAME = process.platform === 'win32' ? 'git.exe' : 'git';
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'refs-git-executable-'));
  const bin = join(root, 'external bin');
  const sources = join(root, 'sources');
  await Promise.all([mkdir(bin), mkdir(sources)]);
  onTestFinished(async () => {
    vi.unstubAllEnvs();
    await rm(root, { force: true, recursive: true });
  });
  return { bin, root, sources };
};

const executableFile = async (path: string): Promise<void> => {
  await writeFile(path, 'fixture executable bytes');
  await chmod(path, EXECUTABLE);
};

describe('absolute Git executable selection', () => {
  it('selects an external absolute file, preserving spaces in PATH', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    const executable = join(setup.bin, GIT_NAME);
    await executableFile(executable);
    const expected = await realpath(executable);
    await expect(
      resolveGitExecutable({ env: { PATH: setup.bin }, roots: [setup.sources] }),
    ).resolves.toBe(expected);
  });

  it('does not use the invocation directory or accept ambiguous Windows PATH keys', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    await expect(resolveGitExecutable({ env: { PATH: setup.bin }, roots: [] })).rejects.toThrow(
      'trusted external Git',
    );
    await expect(
      resolveGitExecutable({ env: { PATH: setup.bin, Path: setup.bin }, roots: [] }, 'win32'),
    ).rejects.toThrow('trusted external Git');
  });
});

const aliasedGitRunner = async (): Promise<SpawnRunner> => {
  const setup = await fixture();
  const tracked = join(setup.sources, 'git');
  await executableFile(tracked);
  await symlink(tracked, join(setup.bin, 'git'));
  vi.stubEnv('PATH', setup.bin);
  const alias = join(setup.root, 'home-alias');
  await symlink(setup.root, alias);
  return new SpawnRunner(join(alias, 'hooks'));
};

describe.skipIf(process.platform === 'win32')('canonical executable provenance', () => {
  it('refuses an external PATH symlink targeting managed content before even git --version', async () => {
    expect.hasAssertions();
    const runner = await aliasedGitRunner();
    const result = await runner.run('git', ['--version']);
    expect(result).toMatchObject({ exitCode: 127, stdout: '' });
    expect(result.stderr).toContain('trusted external helpers');
  });
});

// libuv checks child cwd before PATH on Windows for bare executable names. Copying the already
// installed Node binary gives the wrong executable an unmistakable --version response.
describe.skipIf(process.platform !== 'win32')('windows child cwd executable discovery', () => {
  it('ignores a tracked git.exe during a version query', async () => {
    expect.hasAssertions();
    const setup = await fixture();
    await copyFile(process.execPath, join(setup.sources, 'git.exe'));
    const result = await new SpawnRunner(join(setup.root, 'hooks')).run('git', ['--version'], {
      cwd: setup.sources,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^git version /u);
  });
});
