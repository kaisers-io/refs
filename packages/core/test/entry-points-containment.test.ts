import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEntryPoints } from '../src/entry-points.ts';
import { tmpdir } from 'node:os';

// An observation about a path OUTSIDE the package must not depend on whether that path exists.
//
// `resolveInside` returns `missing` from a `realpath` ENOENT plus a failed no-follow `lstat`,
// computed before and independently of any containment comparison — so it carries no containment
// information at all. Consuming it first split every out-of-package path cleanly in two: something
// is there gave `unverifiable`, nothing is there gave `absent`. `join` clamps `..` at the
// filesystem root, so one target reached any absolute path from any package depth, and each
// `exports` subpath carries its own — one manifest batched many probes into a single reply.
//
// Each pair below differs ONLY in whether the out-of-package path exists. That the two answers
// match is the property; which value they take is not.
//
// Split from `entry-points.test.ts` for the 300-line cap.

// Deep enough that `join` clamps at the filesystem root from any temp-directory depth.
const TRAVERSAL_DEPTH = 16;

const freshPackage = (manifest: Record<string, unknown>): string => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-entry-'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  return dir;
};

/** A directory outside any package, holding one file that exists. */
const outsideDir = (): string => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-outside-'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(dir, 'present.js'), '');
  return dir;
};

const observationsOf = async (dir: string): Promise<string[]> => {
  const { entries } = await readEntryPoints(dir, 'p');
  return entries.map((entry) => (entry.value as { observed: string }).observed);
};

/** The property, stated as a property rather than as one expected value: two targets differing
 * ONLY in whether the out-of-package path exists must observe the same thing, and that thing must
 * not be `absent` — which is the answer that says something about the path.
 *
 * Not pinned to a literal, because the value legitimately differs by platform: on Windows an
 * absolute path carries a drive letter, so `./..` + it contains `:` and `\`, which the probe gate
 * refuses outright as `not_checked`. Refusing earlier is not the bug; answering DIFFERENTLY is. */
const expectSameAndNonCommittal = (observed: readonly string[]): void => {
  expect(new Set(observed).size).toBe(1);
  expect(observed).not.toContain('absent');
};

describe('a target that leaves the package', () => {
  it('says the same thing whether or not the traversal target exists', async () => {
    expect.hasAssertions();
    const outside = outsideDir();
    const up = '../'.repeat(TRAVERSAL_DEPTH);
    const dir = freshPackage({
      exports: {
        './gone': `./${up}${outside.slice(1)}/absent.js`,
        './here': `./${up}${outside.slice(1)}/present.js`,
      },
      name: 'p',
    });

    expectSameAndNonCommittal(await observationsOf(dir));
  });

  it('says the same thing through a symlink, which carries no .. at all', async () => {
    expect.hasAssertions();
    const outside = outsideDir();
    const dir = freshPackage({
      exports: { './gone': './link/absent.js', './here': './link/present.js' },
      name: 'p',
    });
    // The case a lexical `..` guard would not reach: the declared target is an ordinary relative
    // path, and the repository being tracked is also the one that wrote the symlink.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(dir, 'link'), 'dir');

    expectSameAndNonCommittal(await observationsOf(dir));
  });

  it('says the same thing for a trailing-slash target, where lstat sees no link', async () => {
    expect.hasAssertions();
    const outside = outsideDir();
    const dir = freshPackage({
      exports: { './gone': './deadlink/', './here': './livelink/' },
      name: 'p',
    });
    // `./link/` keeps its slash through `join`, and a trailing slash makes `lstat` resolve the
    // link as a directory rather than inspect the link itself — so a link at a directory that does
    // not exist looked like a plain absence, and stepping to the parent walked straight over it.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(dir, 'livelink'), 'dir');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(outside, 'no-such-dir'), join(dir, 'deadlink'), 'dir');

    expectSameAndNonCommittal(await observationsOf(dir));
  });
});

describe('an absence inside the package', () => {
  it('is still reported, however deeply nested', async () => {
    expect.hasAssertions();
    const dir = freshPackage({
      exports: { './deep': './dist/deep/index.js', './flat': './nope.js' },
      name: 'p',
    });

    // The information that had to survive. `./dist/deep` does not exist either, so answering this
    // from the immediate parent alone would report a real absence as uninspected.
    await expect(observationsOf(dir)).resolves.toStrictEqual(['absent', 'absent']);
  });
});

// `withoutTrailingSeparators` is where the walk starts, and its two guards are the ones that keep
// it from turning a root into something else. Exercised through the public surface: a target that
// names the package directory itself, with and without a trailing slash.
describe('a target that names a directory rather than a file', () => {
  it('reports the directory, trailing slash or not', async () => {
    expect.hasAssertions();
    const dir = freshPackage({
      exports: { './plain': './sub', './slashed': './sub/' },
      name: 'p',
    });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(dir, 'sub'));

    await expect(observationsOf(dir)).resolves.toStrictEqual(['directory', 'directory']);
  });

  it('reports an absent nested directory as absent, trailing slash or not', async () => {
    expect.hasAssertions();
    const dir = freshPackage({
      exports: { './plain': './gone/deeper', './slashed': './gone/deeper/' },
      name: 'p',
    });

    // The walk has to climb out of `gone/deeper` to the package directory, and the slashed form
    // must not lose its last component on the way.
    await expect(observationsOf(dir)).resolves.toStrictEqual(['absent', 'absent']);
  });
});
