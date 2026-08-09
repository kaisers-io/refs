import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInside } from '../src/fs-containment.ts';
import { tmpdir } from 'node:os';

// The whole reason this module exists: a boolean "may I read this?" cannot distinguish a file
// that is simply not there from one that is there but unusable. Every case below would collapse
// to the same `false` under the old helper, and treating the first as a failure would mark every
// ordinary repo's scan unreliable.

// eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
const freshDir = (): string => mkdtempSync(join(tmpdir(), 'refs-containment-'));

describe('paths inside the root', () => {
  it('resolves a path below the root as inside', async () => {
    expect.hasAssertions();
    const root = freshDir();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(root, 'pkg'));
    await expect(resolveInside(root, join(root, 'pkg'))).resolves.toStrictEqual({
      kind: 'inside',
      real: expect.stringContaining('pkg') as unknown as string,
    });
  });

  it('treats the root itself as inside', async () => {
    expect.hasAssertions();
    const root = freshDir();
    const result = await resolveInside(root, root);
    expect(result.kind).toBe('inside');
  });
});

describe('paths that are simply not there', () => {
  it('reports a nonexistent path as missing, not unreadable', async () => {
    expect.hasAssertions();
    const root = freshDir();
    // This is the case that matters most: a repo without a pnpm-workspace.yaml is normal, and
    // reporting it as a failure would make every scan unreliable.
    await expect(resolveInside(root, join(root, 'nope'))).resolves.toStrictEqual({
      kind: 'missing',
    });
  });

  it('reports a path under a nonexistent parent as missing', async () => {
    expect.hasAssertions();
    const root = freshDir();
    await expect(resolveInside(root, join(root, 'nope', 'deeper'))).resolves.toStrictEqual({
      kind: 'missing',
    });
  });

  it('reports a path through a file (ENOTDIR) as missing', async () => {
    expect.hasAssertions();
    const root = freshDir();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(root, 'afile'), 'x');
    await expect(resolveInside(root, join(root, 'afile', 'x'))).resolves.toStrictEqual({
      kind: 'missing',
    });
  });

  it('reports a broken symlink as missing', async () => {
    expect.hasAssertions();
    const root = freshDir();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(root, 'gone'), join(root, 'link'));
    await expect(resolveInside(root, join(root, 'link'))).resolves.toStrictEqual({
      kind: 'missing',
    });
  });
});

describe('paths that cannot be used', () => {
  it('reports a symlink escaping the root as outside, resolving before any read', async () => {
    expect.hasAssertions();
    const root = freshDir();
    const outside = freshDir();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(outside, 'secret.json'), '{}');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(root, 'linked'));
    await expect(resolveInside(root, join(root, 'linked', 'secret.json'))).resolves.toStrictEqual({
      kind: 'outside',
    });
  });

  it('reports an unreadable root as unreadable', async () => {
    expect.hasAssertions();
    const missingRoot = join(freshDir(), 'not-there');
    const result = await resolveInside(missingRoot, missingRoot);
    expect(result).toStrictEqual({ code: 'ENOENT', kind: 'unreadable' });
  });
});
