import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { lookupPackagePath, probePackageIdentity } from '../src/package-identity.ts';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A configured `path` is only a LOCATOR — the package NAME is the identity. These tests pin the
// four outcomes, and above all that a failed READ is never reported as an absent package: the
// drift detection built on this would otherwise turn a permissions error or a malformed manifest
// into "the package was removed" and propose deleting a real config entry.

describe('a manifest that says what we expect', () => {
  it('matches when the manifest declares the expected name', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    addPackage(repo, 'packages/zod', { name: 'zod', version: '4.0.0' });
    await expect(probePackageIdentity(repo, 'packages/zod', 'zod')).resolves.toStrictEqual({
      kind: 'match',
    });
  });

  it('verifies a root package configured at "."', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'left-pad', version: '1.3.0' });
    // Single-package repos are stored with `path: "."` by add's npm fallback and are INVISIBLE
    // to workspace detection. Verifying them directly is what stops a drift detector from
    // reporting every one of them as removed.
    await expect(probePackageIdentity(repo, '.', 'left-pad')).resolves.toStrictEqual({
      kind: 'match',
    });
  });

  it('verifies a packument-directory package no workspace pattern covers', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // No `workspaces` field anywhere — this entry came from add's npm fallback, which stores the
    // packument's `directory`. The workspace scan never sees it.
    writeJson(join(repo, 'package.json'), { name: 'the-repo' });
    addPackage(repo, 'src/thing', { name: 'thing' });
    await expect(probePackageIdentity(repo, 'src/thing', 'thing')).resolves.toStrictEqual({
      kind: 'match',
    });
  });
});

describe('a manifest that says something else', () => {
  it('reports a mismatch when another package occupies the path', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    addPackage(repo, 'packages/zod', { name: '@zod/legacy', version: '3.0.0' });
    await expect(probePackageIdentity(repo, 'packages/zod', 'zod')).resolves.toStrictEqual({
      found: '@zod/legacy',
      kind: 'mismatch',
    });
  });

  it('reports a mismatch with found undefined when the manifest declares no name', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    addPackage(repo, 'packages/zod', { private: true, version: '1.0.0' });
    await expect(probePackageIdentity(repo, 'packages/zod', 'zod')).resolves.toStrictEqual({
      found: undefined,
      kind: 'mismatch',
    });
  });
});

describe('nothing at the configured path', () => {
  it('reports absent when the directory does not exist', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // The single most common drift case — a package that moved. If this reported anything other
    // than `absent`, the rescan that finds its new home would never run.
    await expect(probePackageIdentity(repo, 'packages/zod', 'zod')).resolves.toStrictEqual({
      kind: 'absent',
    });
  });

  it('reports absent when the directory exists without a manifest', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    addPackage(repo, 'packages/zod', { name: 'zod' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    rmSync(join(repo, 'packages', 'zod', 'package.json'));
    await expect(probePackageIdentity(repo, 'packages/zod', 'zod')).resolves.toStrictEqual({
      kind: 'absent',
    });
  });

  it('reports absent for a package dir that is a broken symlink', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `realpath` on a symlink whose target is gone rejects with ENOENT, so this lands in
    // `absent` — the right answer: there is no package there.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'nowhere'), join(repo, 'packages-link'));
    await expect(probePackageIdentity(repo, 'packages-link', 'zod')).resolves.toStrictEqual({
      kind: 'absent',
    });
  });
});

describe('a path that cannot be checked', () => {
  it('reports unreadable — not absent — for a malformed manifest', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    addPackage(repo, 'packages/zod', { name: 'zod' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'packages', 'zod', 'package.json'), '{ broken');
    const probe = await probePackageIdentity(repo, 'packages/zod', 'zod');
    expect(probe.kind).toBe('unreadable');
  });

  it('reports unreadable when a directory stands where package.json should be', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'packages', 'zod', 'package.json'), { recursive: true });
    // Something IS there, it just cannot be read as a manifest. Calling that "absent" would let
    // it be inferred as a removal. (The precise errno is platform-dependent; the outcome is not.)
    const probe = await probePackageIdentity(repo, 'packages/zod', 'zod');
    expect(probe.kind).toBe('unreadable');
  });

  it('reports unreadable for a lexically escaping path, before touching the filesystem', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    await expect(probePackageIdentity(repo, '../outside', 'zod')).resolves.toStrictEqual({
      kind: 'unreadable',
      reason: 'path escapes the checkout',
    });
  });

  it('reports unreadable for a symlink whose manifest reads fine but sits outside', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const outside = freshRepo();
    writeJson(join(outside, 'package.json'), { name: 'zod' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(repo, 'linked'));
    // The read would succeed AND the name matches. Containment is the only thing between this
    // and a confident `match` for a directory that is not in the checkout at all — which is why
    // resolution happens before the read, not after.
    await expect(probePackageIdentity(repo, 'linked', 'zod')).resolves.toStrictEqual({
      kind: 'unreadable',
      reason: 'path escapes the checkout',
    });
  });
});

// A scan entry, shaped as detection produces it.
const pkg = (name: string, path: string) => ({ description: undefined, name, path });

describe('finding a package by name', () => {
  it('finds a unique name', () => {
    expect.hasAssertions();
    expect(lookupPackagePath([pkg('zod', 'src/zod')], 'zod')).toStrictEqual({
      kind: 'found',
      path: 'src/zod',
    });
  });

  it('reports absent for a name nowhere in the scan', () => {
    expect.hasAssertions();
    expect(lookupPackagePath([pkg('zod', 'src/zod')], 'zod-core')).toStrictEqual({
      kind: 'absent',
    });
  });

  it('reports absent for an empty scan', () => {
    expect.hasAssertions();
    expect(lookupPackagePath([], 'zod')).toStrictEqual({ kind: 'absent' });
  });
});

describe('a name that is not unique', () => {
  it('reports ambiguous with every path when a name appears twice', () => {
    expect.hasAssertions();
    // Detection deduplicates by PATH, not by name, so two directories declaring the same name
    // both survive — exactly what an in-progress upstream migration looks like. Picking one
    // would be a guess, and a guess here silently points an agent at the wrong source.
    expect(
      lookupPackagePath([pkg('zod', 'src/zod'), pkg('zod', 'packages/zod')], 'zod'),
    ).toStrictEqual({
      kind: 'ambiguous',
      paths: ['packages/zod', 'src/zod'],
    });
  });

  it('sorts ambiguous paths by codepoint, not host collation', () => {
    expect.hasAssertions();
    // `localeCompare` orders these differently (it downweights `-` and `_`) and its ordering is
    // host-dependent; CI runs three platforms and this array is asserted exactly.
    expect(
      lookupPackagePath(
        [pkg('a', 'pkg_b'), pkg('a', 'pkg-b'), pkg('a', 'pkgb'), pkg('a', 'Pkg')],
        'a',
      ),
    ).toStrictEqual({
      kind: 'ambiguous',
      paths: ['Pkg', 'pkg-b', 'pkg_b', 'pkgb'],
    });
  });
});

describe('paths that could never be inside the checkout', () => {
  it.each([['/etc/passwd'], ['../outside'], ['packages/../../etc']])(
    'rejects %s lexically, before touching the filesystem',
    async (relPath) => {
      expect.hasAssertions();
      const repo = freshRepo();
      // The check is purely textual and runs first, so an absolute path or a `..` segment never
      // reaches a filesystem call at all — on any platform, including the Windows drive and UNC
      // forms `isAbsolute` recognises.
      await expect(probePackageIdentity(repo, relPath, 'zod')).resolves.toStrictEqual({
        kind: 'unreadable',
        reason: 'path escapes the checkout',
      });
    },
  );
});
