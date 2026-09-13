import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEntryPoints } from '../src/entry-points.ts';
import { tmpdir } from 'node:os';

// The forms a manifest is allowed to take beside the obvious one, and the two ways there can be
// nothing to report — which are not the same answer.

const freshPackage = (manifest: Record<string, unknown>): string => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-entry-'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  return dir;
};

const LAST = -1;

const touch = (dir: string, rel: string): void => {
  const parts = rel.split('/');
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(dir, ...parts.slice(0, LAST)), { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(dir, ...parts), '');
};

describe('the shorthand forms npm allows', () => {
  it('reads `exports` as the `.` target when it is a string', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ exports: './src/index.ts', name: 'p' });
    touch(dir, 'src/index.ts');

    const { entries } = await readEntryPoints(dir, 'p');

    expect(entries).toStrictEqual([
      {
        from: 'exports',
        subpath: '.',
        value: { kind: 'target', observed: 'file', target: './src/index.ts' },
      },
    ]);
  });

  it('reads a condition map with no subpaths as the `.` target', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ exports: { import: './src/index.ts' }, name: 'p' });
    touch(dir, 'src/index.ts');

    const { entries } = await readEntryPoints(dir, 'p');

    // npm's own rule: a subpath starts with `.`, so a map without one is conditions for `.`.
    expect(entries[0]?.subpath).toBe('.');
    expect(entries[0]?.value).toMatchObject({ kind: 'conditions' });
  });

  it('says nothing about a package that declares nothing', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ name: 'p' });

    const report = await readEntryPoints(dir, 'p');

    // `complete` with no entries: this looked, and the package declares none. That is a different
    // answer from `unverifiable`, which is why both exist.
    expect(report).toStrictEqual({ entries: [], manifest: 'package.json', status: 'complete' });
  });
});

describe('a package directory that cannot be reached', () => {
  it('is unverifiable, not empty', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const dir = mkdtempSync(join(tmpdir(), 'refs-entry-'));

    const report = await readEntryPoints(join(dir, 'nowhere'), 'p');

    expect(report.status).toBe('unverifiable');
    expect(report.entries).toStrictEqual([]);
  });
});

describe('limits and shapes at the edge', () => {
  it('stops descending rather than following a declaration down forever', async () => {
    expect.hasAssertions();
    const TOO_DEEP = 12;
    let nested: unknown = './deep.js';
    for (let level = 0; level < TOO_DEEP; level += 1) {
      nested = { node: nested };
    }
    const dir = freshPackage({ exports: { '.': nested }, name: 'p' });

    const report = await readEntryPoints(dir, 'p');

    // Reported as a shape this does not walk, rather than walked anyway or dropped.
    expect(JSON.stringify(report.entries)).toContain('nested deeper than this reports on');
  });

  it('calls a directory a directory', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ exports: { './styles': './assets' }, name: 'p' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(dir, 'assets'), { recursive: true });

    const { entries } = await readEntryPoints(dir, 'p');

    // An `exports` target may legitimately name one, and calling it absent would be wrong in the
    // same way as calling a pattern absent.
    expect(entries[0]?.value).toStrictEqual({
      kind: 'target',
      observed: 'directory',
      target: './assets',
    });
  });
});
