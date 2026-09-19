import { describe, expect, it } from 'vitest';
import { sep } from 'node:path';
import { withoutTrailingSeparators } from '../src/fs-containment.ts';

// Where the containment walk starts. `./link/` keeps its slash through `join`, and a trailing
// slash makes `lstat` resolve a symlink as a directory instead of inspecting the link — so the
// walk has to begin at the path itself, stripped. The root guard is what stops the stripping from
// turning a path into a different one, and it IS reachable through `readEntryPoints`: enough `../`
// segments make `join` clamp at the filesystem root, leaving a path that is all separator.
//
// Both what counts as a separator and where the root ends are properties of the HOST, so the
// Windows spellings are asserted only where they mean anything. On POSIX a backslash is an
// ordinary filename character, and treating it as a separator renames the basename.

const onWindows = sep === '\\';

describe('stripping the trailing separators from a path', () => {
  it.each([
    ['one slash', '/a/b/', '/a/b'],
    ['several slashes', '/a/b///', '/a/b'],
    ['nothing to strip', '/a/b', '/a/b'],
    ['a relative path', 'a/b/', 'a/b'],
    // The case the old `endsWith(':')` root approximation got wrong: any basename may end in a
    // colon, and one that does is not a drive root.
    ['a basename ending in a colon', '/a/deadlink:/', '/a/deadlink:'],
  ])('strips them: %s', (_label, path, expected) => {
    expect.hasAssertions();

    expect(withoutTrailingSeparators(path)).toBe(expected);
  });

  it.skipIf(onWindows)('leaves a backslash alone, which is an ordinary character here', () => {
    expect.hasAssertions();

    expect(withoutTrailingSeparators(String.raw`/a/b\/`)).toBe('/a/b\\');
  });

  it.runIf(onWindows)('strips a backslash, which is a separator here', () => {
    expect.hasAssertions();

    expect(withoutTrailingSeparators('C:\\a\\b\\')).toBe(String.raw`C:\a\b`);
  });

  it.each([
    ['a posix root', '/', '/'],
    // Stripping stops AT the root rather than short of it, so a doubled leading slash collapses to
    // the root it already names. What matters is that the walk is left something it can terminate
    // on, not that the spelling is preserved byte for byte.
    ['a posix root of several slashes', '//', '/'],
  ])('never strips past a root: %s', (_label, path, expected) => {
    expect.hasAssertions();

    expect(withoutTrailingSeparators(path)).toBe(expected);
  });

  it.runIf(onWindows).each([
    ['a drive root', 'C:\\'],
    // `C:` carries no separator to strip, and is drive-RELATIVE — a different location entirely.
    ['a drive-relative path', 'C:'],
    ['a UNC share root', '\\\\server\\share\\'],
  ])('leaves a windows root alone: %s', (_label: string, path: string) => {
    expect.hasAssertions();

    expect(withoutTrailingSeparators(path)).toBe(path);
  });
});
