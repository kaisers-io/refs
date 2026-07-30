import {
  classifyWorkspacePattern,
  deduplicateAndSort,
  isRelPathContained,
  isSafeWorkspacePattern,
  selectPackageDirs,
  toWorkspacePackage,
} from '../src/workspaces-patterns.ts';
import { describe, expect, it } from 'vitest';
import { join, sep } from 'node:path';

describe('workspace pattern classification', () => {
  it('classifies `<dir>/*` as one-level expansion under that dir', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('packages/*')).toStrictEqual({
      baseDir: 'packages',
      kind: 'expand-children',
    });
  });

  it('classifies bare `*` (flat layout) as expansion under the repo root `.`', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('*')).toStrictEqual({
      baseDir: '.',
      kind: 'expand-children',
    });
  });

  it('classifies a wildcard-free pattern as a literal directory probe', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('docs/site')).toStrictEqual({
      dir: 'docs/site',
      kind: 'probe-dir',
    });
  });

  it('classifies a directory literally named "..packages" as a probe, not an escape', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('..packages')).toStrictEqual({
      dir: '..packages',
      kind: 'probe-dir',
    });
  });
});

describe('unsupported workspace pattern forms', () => {
  it('ignores negation patterns (v1 simplification)', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('!packages/b')).toStrictEqual({ kind: 'ignore' });
  });

  it('ignores deeper glob patterns like ** (v1 simplification)', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('src/**/pkg')).toStrictEqual({ kind: 'ignore' });
  });

  it('ignores a pattern above the single-wildcard budget even when it ends with `/*`', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('packages/*/nested/*')).toStrictEqual({ kind: 'ignore' });
  });

  it('ignores a single wildcard in an unsupported position', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('pkg-*')).toStrictEqual({ kind: 'ignore' });
  });

  it('ignores absolute, leading-.. and mid-pattern .. patterns', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('/etc/*')).toStrictEqual({ kind: 'ignore' });
    expect(classifyWorkspacePattern('../*')).toStrictEqual({ kind: 'ignore' });
    expect(classifyWorkspacePattern('packages/../../etc/*')).toStrictEqual({ kind: 'ignore' });
  });
});

describe('workspace pattern safety', () => {
  it('accepts relative patterns without `.`/`..` segments', () => {
    expect.hasAssertions();
    expect(isSafeWorkspacePattern('packages/*')).toBe(true);
    expect(isSafeWorkspacePattern('..packages')).toBe(true);
  });

  it('rejects absolute patterns and `.`/`..` segments across both separators', () => {
    expect.hasAssertions();
    expect(isSafeWorkspacePattern('/etc')).toBe(false);
    expect(isSafeWorkspacePattern('./packages')).toBe(false);
    expect(isSafeWorkspacePattern('packages/..')).toBe(false);
    expect(isSafeWorkspacePattern(String.raw`packages\..\etc`)).toBe(false);
  });
});

describe('containment decision over relative paths', () => {
  it('rejects the empty relative path unless allowSelf is set', () => {
    expect.hasAssertions();
    expect(isRelPathContained('', false)).toBe(false);
    expect(isRelPathContained('', true)).toBe(true);
  });

  it('accepts a path below the repo root', () => {
    expect.hasAssertions();
    expect(isRelPathContained(join('packages', 'a'), false)).toBe(true);
  });

  it('rejects an exact `..` and a `..` followed by a separator', () => {
    expect.hasAssertions();
    expect(isRelPathContained('..', false)).toBe(false);
    expect(isRelPathContained(`..${sep}outside`, false)).toBe(false);
  });

  it('accepts an entry literally named `..packages` (not a parent escape)', () => {
    expect.hasAssertions();
    expect(isRelPathContained('..packages', false)).toBe(true);
  });

  it('rejects an absolute relative-path result (other drive/root)', () => {
    expect.hasAssertions();
    expect(isRelPathContained(`${sep}other`, false)).toBe(false);
    expect(isRelPathContained(`${sep}other`, true)).toBe(false);
  });
});

describe('candidate package dir selection', () => {
  it('keeps only the dirs whose manifest probe succeeded, in input order', () => {
    expect.hasAssertions();
    expect(selectPackageDirs('packages', ['b', 'a', 'c'], [true, false, true])).toStrictEqual([
      'packages/b',
      'packages/c',
    ]);
  });

  it('always emits /-separated package paths (platform-independent identifiers)', () => {
    expect.hasAssertions();
    const dirs = selectPackageDirs('packages', ['a', 'b'], [true, true]);
    expect(dirs).toStrictEqual(['packages/a', 'packages/b']);
    for (const dir of dirs) {
      expect(dir).not.toContain('\\');
    }
  });

  it('produces root-relative names for the bare `*` base dir `.`', () => {
    expect.hasAssertions();
    expect(selectPackageDirs('.', ['pkg-a'], [true])).toStrictEqual(['pkg-a']);
  });

  it('returns [] when no probe succeeded or there are no dirs', () => {
    expect.hasAssertions();
    expect(selectPackageDirs('packages', ['a'], [false])).toStrictEqual([]);
    expect(selectPackageDirs('packages', [], [])).toStrictEqual([]);
  });
});

describe('manifest shaping', () => {
  it('shapes a manifest with name and description into a package entry', () => {
    expect.hasAssertions();
    expect(
      toWorkspacePackage('packages/a', { description: 'Package A', name: '@mono/a' }),
    ).toStrictEqual({ description: 'Package A', name: '@mono/a', path: 'packages/a' });
  });

  it('keeps a missing description as `undefined`', () => {
    expect.hasAssertions();
    expect(
      toWorkspacePackage('packages/b', { description: undefined, name: '@mono/b' }),
    ).toStrictEqual({ description: undefined, name: '@mono/b', path: 'packages/b' });
  });

  it('rejects a missing manifest and a missing or empty name', () => {
    expect.hasAssertions();
    expect(toWorkspacePackage('packages/a')).toBeUndefined();
    expect(toWorkspacePackage('packages/a', { description: 'x', name: undefined })).toBeUndefined();
    expect(toWorkspacePackage('packages/a', { description: 'x', name: '' })).toBeUndefined();
  });
});

describe('dedupe and sort', () => {
  it('deduplicates by path (last entry wins) and sorts by path', () => {
    expect.hasAssertions();
    const first = { description: 'first', name: '@mono/first', path: 'packages/a' };
    const last = { description: 'last', name: '@mono/last', path: 'packages/a' };
    const other = { description: undefined, name: '@mono/b', path: 'docs/site' };
    expect(deduplicateAndSort([first, other, last])).toStrictEqual([other, last]);
  });

  it('does not mutate its input', () => {
    expect.hasAssertions();
    const pkgA = { description: undefined, name: '@mono/a', path: 'packages/b' };
    const pkgB = { description: undefined, name: '@mono/b', path: 'packages/a' };
    const input = [pkgA, pkgB];
    expect(deduplicateAndSort(input)).toStrictEqual([pkgB, pkgA]);
    expect(input).toStrictEqual([pkgA, pkgB]);
  });
});
