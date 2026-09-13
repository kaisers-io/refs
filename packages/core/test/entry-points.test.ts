import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEntryPoints } from '../src/entry-points.ts';
import { tmpdir } from 'node:os';

// What a package DECLARES as its entry points, and what is at each target.
//
// Reported, never resolved. Resolving means choosing conditions, and which condition is right
// depends on the consumer — a choice refs has no standing to make, and the reason no resolver
// library is involved: `resolve.exports` and `resolve-pkg-maps` both require the caller to supply
// the conditions, which is exactly the input refs does not have.

// eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
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

describe('conditions', () => {
  it('keeps every condition, including ones no resolver knows', async () => {
    expect.hasAssertions();
    const dir = freshPackage({
      exports: { '.': { '@zod/source': './src/index.ts', import: './index.js' } },
      name: 'p',
    });
    touch(dir, 'src/index.ts');

    const { entries } = await readEntryPoints(dir);

    // The shape measured on a real checkout: the standard conditions point at files a source tree
    // does not have, and the ONE that exists is non-standard. Reporting only known condition names
    // would hide the only usable answer.
    expect(entries[0]?.value).toStrictEqual({
      branches: [
        {
          condition: '@zod/source',
          value: { kind: 'target', observed: 'file', target: './src/index.ts' },
        },
        {
          condition: 'import',
          value: { kind: 'target', observed: 'absent', target: './index.js' },
        },
      ],
      kind: 'conditions',
    });
  });

  it('keeps the declared order, which is what decides resolution', async () => {
    expect.hasAssertions();
    const dir = freshPackage({
      exports: { '.': { default: './d.js', types: './t.d.ts' } },
      name: 'p',
    });

    const { entries } = await readEntryPoints(dir);

    expect(entries[0]?.value).toMatchObject({
      branches: [{ condition: 'default' }, { condition: 'types' }],
    });
  });
});

describe('alternatives', () => {
  it('keeps them as alternatives, never as a list of equals', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ exports: { '.': ['./missing.js', './there.js'] }, name: 'p' });
    touch(dir, 'there.js');

    const { entries } = await readEntryPoints(dir);

    // `["./missing.js", "./there.js"]` does NOT mean "the first one that exists": Node takes the
    // first string, and an absent file does not fall through to the second. Flattening the two
    // would imply a fallback that does not happen.
    expect(entries[0]?.value).toStrictEqual({
      alternatives: [
        { kind: 'target', observed: 'absent', target: './missing.js' },
        { kind: 'target', observed: 'file', target: './there.js' },
      ],
      kind: 'alternatives',
    });
  });
});

describe('shapes that are not a plain target', () => {
  it('keeps an explicit null, which excludes a subpath', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line unicorn/no-null -- the declaration under test IS a null
    const excluded = null;
    const dir = freshPackage({ exports: { '.': './i.js', './internal/*': excluded }, name: 'p' });

    const { entries } = await readEntryPoints(dir);

    // Dropping it would report the opposite of what the manifest says: that subpath is ruled out.
    expect(entries.find((entry) => entry.subpath === './internal/*')?.value).toStrictEqual({
      kind: 'excluded',
    });
  });

  it('does not probe a pattern', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ exports: { './lib/*': './src/*.js' }, name: 'p' });

    const { entries } = await readEntryPoints(dir);

    // Statting `./src/*.js` literally would report `absent` about a filename nobody declared.
    expect(entries[0]?.value).toStrictEqual({
      kind: 'target',
      observed: 'not_checked',
      target: './src/*.js',
    });
  });

  it('does not probe a target carrying a query or fragment', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ exports: { '.': './i.js?v=2' }, name: 'p' });

    const { entries } = await readEntryPoints(dir);

    expect(entries[0]?.value).toStrictEqual({
      kind: 'target',
      observed: 'not_checked',
      target: './i.js?v=2',
    });
  });
});

describe('legacy fields', () => {
  it('reports them beside exports, each naming the field it came from', async () => {
    expect.hasAssertions();
    const dir = freshPackage({ exports: { '.': './e.js' }, main: 'dist/main.js', name: 'p' });

    const { entries } = await readEntryPoints(dir);

    // Suppressing them because `exports` exists would enforce a resolver's precedence — a claim
    // about what a consumer does, and the consumer here reads source. `main` is also written
    // without the `./` that exports requires.
    expect(entries.map((entry) => entry.from)).toStrictEqual(['exports', 'main']);
    expect(entries[1]?.value).toStrictEqual({
      kind: 'target',
      observed: 'absent',
      target: './dist/main.js',
    });
  });
});

describe('a manifest that cannot be read', () => {
  it('says so rather than reporting an empty declaration', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const dir = mkdtempSync(join(tmpdir(), 'refs-entry-'));
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(dir, 'package.json'), '{ not json');

    const report = await readEntryPoints(dir);

    // An empty `entries` with `complete` would assert this package declares no entry points, which
    // is a different fact and one this never established.
    expect(report.status).toBe('unverifiable');
    expect(report.entries).toStrictEqual([]);
  });
});

describe('a target that leaves the package', () => {
  it('is reported as unverifiable, not as present', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const outside = mkdtempSync(join(tmpdir(), 'refs-outside-'));
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(outside, 'secret.js'), '');
    const dir = freshPackage({ exports: { '.': './link/secret.js' }, name: 'p' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(dir, 'link'), 'dir');

    const { entries } = await readEntryPoints(dir);

    // The containment rule the rest of refs applies: a path that resolves outside the tree it was
    // read from is not something this reports as present.
    expect(entries[0]?.value).toStrictEqual({
      kind: 'target',
      observed: 'unverifiable',
      target: './link/secret.js',
    });
  });
});
