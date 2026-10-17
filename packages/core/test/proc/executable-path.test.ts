import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { resolveExecutable } from '../../src/proc/executable-path.ts';
import { tmpdir } from 'node:os';

// refs runs git with `cwd` inside a checkout, which is somebody else's repository. A program the
// checkout carries must never run in git's place: not through Windows' current-directory search
// (libuv tries the child's cwd before PATH), and not through an empty or relative PATH entry,
// which every platform resolves against the child's cwd.

const EXECUTABLE = 0o755;
const IS_WINDOWS = process.platform === 'win32';

const scratch = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-exec-path-'));
  onTestFinished(() => rm(dir, { force: true, recursive: true }));
  return dir;
};

const runnable = async (path: string): Promise<string> => {
  await writeFile(path, '#!/bin/sh\nexit 0\n');
  await chmod(path, EXECUTABLE);
  return path;
};

describe('resolving a bare command name', () => {
  // POSIX resolution on the real file system: needs POSIX paths and the execute bit.
  it.skipIf(IS_WINDOWS)('takes the first absolute PATH directory that holds it', async () => {
    expect.hasAssertions();
    const dir = await scratch();
    await Promise.all([mkdir(join(dir, 'a')), mkdir(join(dir, 'b'))]);
    const expected = await runnable(join(dir, 'b', 'tool'));
    await runnable(join(dir, 'c-not-on-path'));
    const env = { PATH: [join(dir, 'a'), join(dir, 'b')].join(':') };
    await expect(resolveExecutable('tool', env, 'linux')).resolves.toBe(expected);
  });

  it('ignores empty and relative PATH entries, which mean the working directory', async () => {
    expect.hasAssertions();
    const env = { PATH: ['', '.', 'bin', './bin'].join(':') };
    await expect(resolveExecutable('sh', env, 'linux')).resolves.toBeUndefined();
  });

  // POSIX resolution on the real file system: needs POSIX paths and the execute bit.
  it.skipIf(IS_WINDOWS)('skips a directory or a file without the execute bit', async () => {
    expect.hasAssertions();
    const dir = await scratch();
    await mkdir(join(dir, 'tool'));
    await writeFile(join(dir, 'other'), 'not executable');
    const env = { PATH: dir };
    await expect(resolveExecutable('tool', env, 'linux')).resolves.toBeUndefined();
    await expect(resolveExecutable('other', env, 'linux')).resolves.toBeUndefined();
  });

  it('leaves a name that already names a directory to the caller', async () => {
    expect.hasAssertions();
    await expect(resolveExecutable('./git', {}, 'linux')).resolves.toBe('./git');
    await expect(resolveExecutable(String.raw`C:\Git\git.exe`, {}, 'win32')).resolves.toBe(
      String.raw`C:\Git\git.exe`,
    );
  });
});

describe.runIf(IS_WINDOWS)('resolving a bare command name on Windows', () => {
  it('tries .com before .exe, reads Path in any case, and ignores relative entries', async () => {
    expect.hasAssertions();
    const dir = await scratch();
    await Promise.all([writeFile(join(dir, 'tool.exe'), ''), writeFile(join(dir, 'tool.com'), '')]);
    const env = { Path: ['.', 'rel', `"${dir}"`].join(';') };
    await expect(resolveExecutable('tool', env, 'win32')).resolves.toBe(join(dir, 'tool.com'));
  });
});

// The attack itself, through the real runner: a "git" planted in the directory git is run from.
describe('a git program inside the working directory', () => {
  it.skipIf(IS_WINDOWS)('does not run through an empty PATH entry', async () => {
    expect.hasAssertions();
    const checkout = await scratch();
    const marker = join(checkout, 'ran');
    await writeFile(join(checkout, 'git'), `#!/bin/sh\necho planted > '${marker}'\n`);
    await chmod(join(checkout, 'git'), EXECUTABLE);
    vi.stubEnv('PATH', `${delimiter}${String(process.env['PATH'])}`);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const result = await new SpawnRunner().run('git', ['--version'], { cwd: checkout });
    expect(result.stdout).toMatch(/^git version /u);
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.runIf(IS_WINDOWS)('does not run through the Windows current-directory search', async () => {
    expect.hasAssertions();
    const checkout = await scratch();
    // Any real executable will do; node prints its own version for `--version`, git prints its.
    await copyFile(process.execPath, join(checkout, 'git.exe'));
    const result = await new SpawnRunner().run('git', ['--version'], { cwd: checkout });
    expect(result.stdout).toMatch(/^git version /u);
  });

  it('reports a command it cannot find on PATH as a spawn failure, without throwing', async () => {
    expect.hasAssertions();
    const result = await new SpawnRunner().run('refs-no-such-program', []);
    expect(result).toMatchObject({ exitCode: 127, stdout: '' });
    expect(result.stderr).toContain('never runs a program from the working directory');
  });
});
