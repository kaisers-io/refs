import { assertInsideSources, checkoutPath, configBackupPath, resolveHome } from '../src/home.ts';
import { describe, expect, it } from 'vitest';
import { isAbsolute, join } from 'node:path';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { zRefKey } from '../src/schemas/primitives.ts';

const makeHome = (): ReturnType<typeof resolveHome> => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-home-'));
  return resolveHome({ REFS_HOME: dir });
};

// eslint-disable-next-line vitest/prefer-describe-function-title -- verbatim test contract from task brief
describe('resolveHome', () => {
  it('honours REFS_HOME and derives all paths', () => {
    expect.hasAssertions();
    const home = resolveHome({ REFS_HOME: '/x/y' });
    expect(home).toStrictEqual({
      configPath: '/x/y/config.toml',
      hooksDir: '/x/y/hooks',
      locksDir: '/x/y/locks',
      root: '/x/y',
      sourcesDir: '/x/y/sources',
      statePath: '/x/y/state.json',
    });
  });

  it('defaults to ~/.kaisers-io/refs', () => {
    expect.hasAssertions();
    expect(resolveHome({}).root.endsWith('/.kaisers-io/refs')).toBe(true);
  });

  it('resolves a relative REFS_HOME to absolute paths', () => {
    expect.hasAssertions();
    const home = resolveHome({ REFS_HOME: 'relative/dir' });
    expect(isAbsolute(home.root)).toBe(true);
    expect(isAbsolute(home.sourcesDir)).toBe(true);
    expect(home.root.endsWith(join('relative', 'dir'))).toBe(true);
  });
});

describe('home: configBackupPath', () => {
  it('derives the single shared backup path from configPath', () => {
    expect.hasAssertions();
    const home = resolveHome({ REFS_HOME: '/x/y' });
    expect(configBackupPath(home)).toBe('/x/y/config.toml.bak');
  });
});

describe('containment', () => {
  it('derives checkout paths inside sources and rejects escapes', () => {
    expect.hasAssertions();
    const home = makeHome();
    const key = zRefKey.parse('github.com/vercel/next.js');
    const path = checkoutPath(home, key);
    expect(path).toBe(join(home.sourcesDir, 'github.com', 'vercel', 'next.js'));
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(path, { recursive: true });
    expect(() => assertInsideSources(home, path)).not.toThrow();
    expect(() => assertInsideSources(home, home.sourcesDir)).toThrow(/containment/u);
    expect(() => assertInsideSources(home, join(home.root, 'config.toml'))).toThrow(/containment/u);
  });

  it('rejects symlinks pointing outside sources', () => {
    expect.hasAssertions();
    const home = makeHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(home.sourcesDir, { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const outside = mkdtempSync(join(tmpdir(), 'refs-outside-'));
    const link = join(home.sourcesDir, 'sneaky');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, link);
    expect(() => assertInsideSources(home, link)).toThrow(/containment/u);
  });
});

// Split out of the `containment` describe above purely to keep it under the repo's
// max-lines-per-function cap.
describe('containment: boundary predicate edge cases', () => {
  it('handles targets whose walk-up reaches filesystem root without corrupting the path', () => {
    expect.hasAssertions();
    /*
     * These two roots differ only in their first character ('a' vs 'b'); the old
     * `current.slice(parent.length + SEPARATOR_LENGTH)` bug drops '/' plus that first
     * character when parent is the filesystem root ('/'), so both '/aroot-marker' and
     * '/broot-marker' collapsed to the identical corrupted ancestor 'root-marker' and
     * the guard would have wrongly accepted the escape.
     */
    const home = resolveHome({ REFS_HOME: '/aroot-marker' });
    expect(() => assertInsideSources(home, '/broot-marker/sources/repo')).toThrow(/containment/u);
  });

  it('rejects sibling top-level paths that would collide under the old slice bug', () => {
    expect.hasAssertions();
    const home = resolveHome({ REFS_HOME: '/abc' });
    expect(() => assertInsideSources(home, '/dbc/sources/repo')).toThrow(/containment/u);
  });

  it('accepts a ref-key segment starting with ".." that is not an escape', () => {
    expect.hasAssertions();
    // A segment like `..name` passes zRefKey's SAFE_SEGMENT (only bare `.` and `..` are
    // rejected), so `rel.startsWith('..')` alone would wrongly reject this legitimate,
    // fully-contained checkout path.
    const home = makeHome();
    const path = join(home.sourcesDir, 'example.com', 'owner', '..name');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(path, { recursive: true });
    expect(() => assertInsideSources(home, path)).not.toThrow();
  });

  it('accepts a top-level ".."-prefixed segment directly under sourcesDir', () => {
    expect.hasAssertions();
    // Same false positive at its sharpest: when the offending segment is the entire
    // relative path (`rel === '..name'`), a bare `rel.startsWith('..')` rejects it even
    // though it never leaves sourcesDir. Only `rel === '..'` or `rel.startsWith('../')`
    // means an actual escape.
    const home = makeHome();
    const path = join(home.sourcesDir, '..name');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(path, { recursive: true });
    expect(() => assertInsideSources(home, path)).not.toThrow();
  });
});
