import {
  deduplicateAndSort,
  isRelPathContained,
  scanIsReliable,
  sortDiagnostics,
  toWorkspacePackage,
} from '../src/workspaces-patterns.ts';
import { describe, expect, it } from 'vitest';
import { join, sep } from 'node:path';
import { isSafeWorkspacePattern } from '../src/workspaces-shapes.ts';

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

describe('manifest shaping', () => {
  it('shapes a named manifest into a package entry — identity only', () => {
    expect.hasAssertions();
    expect(toWorkspacePackage('packages/a', { name: '@mono/a' })).toStrictEqual({
      name: '@mono/a',
      path: 'packages/a',
    });
  });

  it('rejects a missing manifest and a missing or empty name', () => {
    expect.hasAssertions();
    expect(toWorkspacePackage('packages/a')).toBeUndefined();
    expect(toWorkspacePackage('packages/a', { name: undefined })).toBeUndefined();
    expect(toWorkspacePackage('packages/a', { name: '' })).toBeUndefined();
  });
});

describe('dedupe and sort', () => {
  it('deduplicates by path (last entry wins) and sorts by path', () => {
    expect.hasAssertions();
    const first = { name: '@mono/first', path: 'packages/a' };
    const last = { name: '@mono/last', path: 'packages/a' };
    const other = { name: '@mono/b', path: 'docs/site' };
    expect(deduplicateAndSort([first, other, last])).toStrictEqual([other, last]);
  });

  it('does not mutate its input', () => {
    expect.hasAssertions();
    const pkgA = { name: '@mono/a', path: 'packages/b' };
    const pkgB = { name: '@mono/b', path: 'packages/a' };
    const input = [pkgA, pkgB];
    expect(deduplicateAndSort(input)).toStrictEqual([pkgB, pkgA]);
    expect(input).toStrictEqual([pkgA, pkgB]);
  });
});

describe('scan reliability', () => {
  it('is reliable with no diagnostics', () => {
    expect.hasAssertions();
    expect(scanIsReliable({ diagnostics: [], packages: [] })).toBe(true);
  });

  it.each([
    [{ kind: 'no_workspace_declaration' } as const],
    [{ kind: 'manifest_missing_name', path: 'packages/a' } as const],
  ])('stays reliable for %o — a complete observation, not a failure to observe', (diagnostic) => {
    expect.hasAssertions();
    // `no_workspace_declaration`: an ordinary single-package repo; the empty scan is correct.
    // `manifest_missing_name`: the manifest WAS read and declares no usable name, so there is
    // no resolvable package there and we know it. Marking this unreliable would let one
    // nameless package.json under a workspace glob permanently suppress every removal
    // detection for that repo — and nameless manifests are real (zod's own root has none).
    expect(scanIsReliable({ diagnostics: [diagnostic], packages: [] })).toBe(true);
  });

  it.each([
    [{ file: 'pnpm-workspace.yaml', kind: 'workspace_file_unreadable' } as const],
    [{ kind: 'workspace_dir_unreadable', path: 'packages' } as const],
    [{ kind: 'unsupported_pattern', pattern: 'packages/**/deep' } as const],
    [{ kind: 'manifest_unreadable', path: 'packages/a' } as const],
    [{ kind: 'candidate_not_inspected', path: 'packages/a' } as const],
  ])('is unreliable for %o', (diagnostic) => {
    expect.hasAssertions();
    // Each of these means the scan may be MISSING packages that really exist — so a name's
    // absence from it proves nothing, and no removal may ever be inferred.
    expect(scanIsReliable({ diagnostics: [diagnostic], packages: [] })).toBe(false);
  });
});

describe('diagnostic ordering', () => {
  it('sorts by kind, then by the identifying field', () => {
    expect.hasAssertions();
    expect(
      sortDiagnostics([
        { kind: 'unsupported_pattern', pattern: 'a/**' },
        { kind: 'manifest_unreadable', path: 'z/pkg' },
        { kind: 'no_workspace_declaration' },
        { kind: 'manifest_unreadable', path: 'a/pkg' },
        { file: 'package.json', kind: 'workspace_file_unreadable' },
      ]),
    ).toStrictEqual([
      { kind: 'manifest_unreadable', path: 'a/pkg' },
      { kind: 'manifest_unreadable', path: 'z/pkg' },
      { kind: 'no_workspace_declaration' },
      { kind: 'unsupported_pattern', pattern: 'a/**' },
      { file: 'package.json', kind: 'workspace_file_unreadable' },
    ]);
  });

  it('does not mutate its input', () => {
    expect.hasAssertions();
    const input = [
      { kind: 'no_workspace_declaration' } as const,
      { kind: 'manifest_unreadable', path: 'a' } as const,
    ];
    sortDiagnostics(input);
    expect(input).toStrictEqual([
      { kind: 'no_workspace_declaration' },
      { kind: 'manifest_unreadable', path: 'a' },
    ]);
  });
});

describe('diagnostic ordering is host-independent', () => {
  it('orders by codepoint, not host collation', () => {
    expect.hasAssertions();
    // `localeCompare` orders these differently (it downweights `-` and `_`) and its ordering
    // is host-dependent; CI runs macOS, Linux and Windows and this array is asserted exactly.
    expect(
      sortDiagnostics([
        { kind: 'manifest_unreadable', path: 'pkgb' },
        { kind: 'manifest_unreadable', path: 'pkg_b' },
        { kind: 'manifest_unreadable', path: 'pkg-b' },
        { kind: 'manifest_unreadable', path: 'Pkg' },
      ]),
    ).toStrictEqual([
      { kind: 'manifest_unreadable', path: 'Pkg' },
      { kind: 'manifest_unreadable', path: 'pkg-b' },
      { kind: 'manifest_unreadable', path: 'pkg_b' },
      { kind: 'manifest_unreadable', path: 'pkgb' },
    ]);
  });
});
