import { describe, expect, it } from 'vitest';
import {
  includePathCandidates,
  isMissing,
  missingPathCandidates,
} from '../../src/proc/git-config-missing.ts';

const roots = { cwd: 'D:/caller', protectedRoots: ['C:/refs/sources', 'd:/caller'] };
const FAILURE = 'Git configuration cannot be safely inventoried';

describe('windows missing configuration paths', () => {
  it('checks rooted paths on every client worktree drive, with native case and separators', () => {
    expect.hasAssertions();
    expect(missingPathCandidates('/github/runner_temp/config', roots, 'win32')).toStrictEqual([
      String.raw`D:\github\runner_temp\config`,
      String.raw`C:\github\runner_temp\config`,
      String.raw`d:\github\runner_temp\config`,
    ]);
    expect(missingPathCandidates('C:/external/config', roots, 'win32')).toStrictEqual([
      String.raw`C:\external\config`,
    ]);
  });

  it('retains the invocation drive before a cross-drive directory alias is resolved', () => {
    expect.hasAssertions();
    const paths = { cwd: 'C:/caller', lookupRoots: ['D:/alias'], protectedRoots: ['C:/sources'] };
    expect(missingPathCandidates('/external/config', paths, 'win32')).toStrictEqual([
      String.raw`C:\external\config`,
      String.raw`D:\external\config`,
    ]);
  });

  it('checks rooted paths relative to UNC shares as well as drive roots', () => {
    expect.hasAssertions();
    const paths = { cwd: String.raw`\\server\share\caller`, protectedRoots: ['C:/sources'] };
    expect(missingPathCandidates('/external/config', paths, 'win32')).toStrictEqual([
      String.raw`\\server\share\external\config`,
      String.raw`C:\external\config`,
    ]);
    expect(missingPathCandidates(String.raw`\\server\share\config`, paths, 'win32')).toStrictEqual([
      String.raw`\\server\share\config`,
    ]);
  });

  it.each(['relative', 'C:drive-relative', 'C:/path/../config', String.raw`C:\path\.\config`])(
    'refuses ambiguous missing paths %j',
    (path) => {
      expect.hasAssertions();
      expect(() => missingPathCandidates(path, roots, 'win32')).toThrow(FAILURE);
    },
  );
});

describe('missing path validation', () => {
  it('refuses unresolved Windows cwd roots', () => {
    expect.hasAssertions();
    expect(() =>
      missingPathCandidates('/external', { cwd: '/caller', protectedRoots: [] }, 'win32'),
    ).toThrow(FAILURE);
  });

  it('preserves a plain absolute POSIX path and refuses relative paths', () => {
    expect.hasAssertions();
    expect(missingPathCandidates('/external/config', roots, 'linux')).toStrictEqual([
      '/external/config',
    ]);
    expect(() => missingPathCandidates('relative', roots, 'linux')).toThrow(FAILURE);
  });

  it('recognizes only ENOENT filesystem errors', () => {
    expect.hasAssertions();
    const missing = Object.assign(new Error('fixture'), { code: 'ENOENT' });
    expect(isMissing(missing)).toBe(true);
    const notDirectory = Object.assign(new Error('fixture'), { code: 'ENOTDIR' });
    expect(isMissing(notDirectory)).toBe(false);
    expect(isMissing(new Error('fixture'))).toBe(false);
    expect(isMissing({ code: 'ENOENT' })).toBe(false);
  });
});

describe('unsupported Windows namespaces', () => {
  it.each([
    String.raw`\\?\C:\external\config`,
    String.raw`\\?\UNC\server\share\config`,
    String.raw`\\.\C:\config`,
  ])('refuses %s rather than scanning a different nonexistent pathname', (path) => {
    expect.hasAssertions();
    expect(() => includePathCandidates(path, roots, 'win32')).toThrow(FAILURE);
  });
});
