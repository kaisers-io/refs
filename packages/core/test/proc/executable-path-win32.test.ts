import { access, stat } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { resolveExecutable } from '../../src/proc/executable-path.ts';

// Windows lookup rules, run on every platform. `executable-path.test.ts` proves them against a
// real Windows file system, but only on Windows, where nothing gates coverage; here the file system
// is replaced by a set of Windows paths, so a regression in the rules fails on every runner.

// `stat` is overloaded and vi.fn's inferred type cannot reproduce every overload, so it is cast
// back to the original signature, as `lock-inspect-unreadable.test.ts` does.
vi.mock(import('node:fs/promises'), async (importOriginal) => ({
  ...(await importOriginal()),
  access: vi.fn<typeof access>(),
  stat: vi.fn<(path: string) => Promise<unknown>>() as unknown as typeof stat,
}));

const absent = (): Promise<never> =>
  Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

/** Makes exactly `paths` exist as files; every other path is absent. */
const filesystemWith = (paths: readonly string[]): void => {
  const present = new Set(paths);
  vi.mocked(stat).mockImplementation((path) =>
    present.has(String(path)) ? Promise.resolve({ isFile: () => true } as never) : absent(),
  );
  vi.mocked(access).mockImplementation((path) =>
    present.has(String(path)) ? Promise.resolve() : absent(),
  );
};

describe('resolving a bare command name on Windows', () => {
  it('tries .com before .exe in each directory', async () => {
    expect.hasAssertions();
    filesystemWith([String.raw`C:\Tools\tool.exe`, String.raw`C:\Tools\tool.com`]);

    await expect(resolveExecutable('tool', { PATH: String.raw`C:\Tools` }, 'win32')).resolves.toBe(
      String.raw`C:\Tools\tool.com`,
    );
  });

  it('reads Path in any case and strips the quotes around an entry', async () => {
    expect.hasAssertions();
    filesystemWith([String.raw`C:\Program Files\Git\cmd\git.exe`]);

    await expect(
      resolveExecutable('git', { Path: String.raw`"C:\Program Files\Git\cmd"` }, 'win32'),
    ).resolves.toBe(String.raw`C:\Program Files\Git\cmd\git.exe`);
  });

  it('never takes a relative or drive-relative entry, which means the working directory', async () => {
    expect.hasAssertions();
    // `\bin` and `C:bin` are both resolved against the current drive or directory, so a `git.exe`
    // reached through them could be one a checkout carries. Only a drive root or a UNC share counts.
    filesystemWith([
      String.raw`\bin\git.exe`,
      String.raw`C:bin\git.exe`,
      String.raw`rel\git.exe`,
      String.raw`\\server\share\git.exe`,
    ]);
    const PATH = [String.raw`\bin`, 'C:bin', 'rel', '', String.raw`\\server\share`].join(';');

    await expect(resolveExecutable('git', { PATH }, 'win32')).resolves.toBe(
      String.raw`\\server\share\git.exe`,
    );
  });

  it('tries a name that already has an extension as given first', async () => {
    expect.hasAssertions();
    filesystemWith([String.raw`D:\bin\git.exe`, String.raw`D:\bin\git.exe.com`]);

    await expect(resolveExecutable('git.exe', { PATH: String.raw`D:\bin` }, 'win32')).resolves.toBe(
      String.raw`D:\bin\git.exe`,
    );
  });
});
