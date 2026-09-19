import { describe, expect, it } from 'vitest';
import { withoutTrailingSeparators } from '../src/fs-containment.ts';

// Where the containment walk starts. `./link/` keeps its slash through `join`, and a trailing
// slash makes `lstat` resolve a symlink as a directory instead of inspecting the link — so the
// walk has to begin at the path itself, stripped. The two guards are what stop the stripping from
// turning a path into a different one, and neither is reachable through `readEntryPoints`: a
// joined target always carries the package directory as a prefix, so it is never all separator and
// never a bare drive.

describe('stripping the trailing separators from a path', () => {
  it.each([
    ['one slash', '/a/b/', '/a/b'],
    ['several slashes', '/a/b///', '/a/b'],
    ['a backslash', 'C:\\a\\b\\', String.raw`C:\a\b`],
    ['nothing to strip', '/a/b', '/a/b'],
    ['a relative path', 'a/b/', 'a/b'],
  ])('strips them: %s', (_label, path, expected) => {
    expect.hasAssertions();

    expect(withoutTrailingSeparators(path)).toBe(expected);
  });

  it.each([
    ['a posix root', '/'],
    ['a posix root of several slashes', '//'],
    ['a windows drive root', 'C:\\'],
    ['a windows UNC root', String.raw`\\`],
  ])('leaves a root alone, because stripping would rename it: %s', (_label, path) => {
    expect.hasAssertions();

    // `/` stripped is the empty string, and `C:` without its separator is drive-RELATIVE — a
    // different location from the drive root.
    expect(withoutTrailingSeparators(path)).toBe(path);
  });
});
