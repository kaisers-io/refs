import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { detectWorkspacePackages } from '../src/workspaces.ts';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';

// Wraps the real `readdir` in a spy so tests can assert no directory read is attempted for
// untrusted patterns, while all other tests keep the real behavior. Symlink-containment
// tests (both `readdir` and `readFile` spies) live in `workspaces-containment.test.ts`.
vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  // `readdir` is heavily overloaded; vi.fn's inferred mock type can't reproduce every
  // overload, so the mock is cast back to the original signature after wrapping it.
  const readdirSpy = vi.fn<typeof actual.readdir>(
    actual.readdir as never,
  ) as unknown as typeof actual.readdir;
  return { ...actual, readdir: readdirSpy };
});

const readdirMock = vi.mocked(readdir);

describe('npm workspaces', () => {
  it('reads the array form, sorts by path, missing description → undefined', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(repo, 'packages/b', { name: '@mono/b', version: '1.0.0' });
    addPackage(repo, 'packages/a', { description: 'Package A', name: '@mono/a' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Package A', name: '@mono/a', path: 'packages/a' },
      { description: undefined, name: '@mono/b', path: 'packages/b' },
    ]);
  });

  it('reads the {packages: [...]} object form', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), {
      workspaces: { packages: ['packages/*'] },
    });
    addPackage(repo, 'packages/a', { description: 'Package A', name: '@mono/a' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Package A', name: '@mono/a', path: 'packages/a' },
    ]);
  });

  it('ignores non-string entries in the array form instead of throwing', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const nonStringWorkspaceEntry = 123;
    writeJson(join(repo, 'package.json'), {
      workspaces: [nonStringWorkspaceEntry, 'packages/*'],
    });
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
  });
});

describe('pnpm workspaces', () => {
  it('parses pnpm-workspace.yaml and applies negation patterns', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/b'\n",
    );
    addPackage(repo, 'packages/a', { description: 'Package A', name: '@mono/a' });
    addPackage(repo, 'packages/b', { description: 'Package B', name: '@mono/b' });
    // `!packages/b` is expanded like any other pattern and subtracted, so only `@mono/a` remains.
    // Leaving it in registered packages the repository declared out of scope, and made every
    // package in such a repository unreportable.
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Package A', name: '@mono/a', path: 'packages/a' },
    ]);
  });

  it('detects a pattern followed by an inline comment', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/* # workspaces\n');
    addPackage(repo, 'packages/a', { description: 'Package A', name: '@mono/a' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Package A', name: '@mono/a', path: 'packages/a' },
    ]);
  });

  it('recognizes a `packages:` header followed by an inline comment', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      'packages: # workspace packages\n  - packages/a\n',
    );
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
  });
});

describe('pnpm workspaces header placement', () => {
  it('ignores an indented `packages:` key nested under another key', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      'catalog:\n  packages:\n    - packages/b\npackages:\n  - packages/a\n',
    );
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    addPackage(repo, 'packages/b', { name: '@mono/b', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
  });
});

describe('plain repositories', () => {
  it('returns [] when package.json has no workspaces field', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'single-package', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
  });

  it('returns [] when neither package.json nor pnpm-workspace.yaml exists', async () => {
    expect.hasAssertions();
    await expect(detectWorkspacePackages(freshRepo())).resolves.toStrictEqual([]);
  });
});

// Symlink-containment tests (root/member manifest symlinks escaping the repo) live in
// `workspaces-containment.test.ts`, which needs the `readFile` spy this file does not.

describe('glob expansion', () => {
  it('ignores deeper glob patterns like ** (v1 simplification)', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['src/**/pkg'] });
    addPackage(repo, 'src/deep/pkg', { name: '@deep/pkg', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
  });
});

describe('literal pattern normalization', () => {
  it('trims a trailing slash from a literal pattern', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // Both npm and pnpm accept `packages/new/`. The path it yields is an IDENTIFIER, though: it is
    // compared against configured entries and against paths git reports, and it is printed into
    // `refs edit --create --path`, which `zPackagePath` rejects outright with a trailing slash.
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/new/'] });
    addPackage(repo, 'packages/new', { name: '@mono/new', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/new', path: 'packages/new' },
    ]);
  });

  it('collapses repeated separators in a literal pattern', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `packages//new/` selects the same directory as `packages/new` for npm and pnpm alike, but
    // yields a path with an empty segment — which `zPackagePath` rejects, so the repair command
    // printed for it would not run.
    writeJson(join(repo, 'package.json'), { workspaces: ['packages//new/'] });
    addPackage(repo, 'packages/new', { name: '@mono/new', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/new', path: 'packages/new' },
    ]);
  });
});

describe('glob expansion, continued', () => {
  it('resolves non-glob paths like docs/site directly', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['docs/site'] });
    addPackage(repo, 'docs/site', { description: 'Documentation site', name: 'docs' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Documentation site', name: 'docs', path: 'docs/site' },
    ]);
  });

  it('detects direct child packages for a bare `*` pattern (flat layout)', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['*'] });
    addPackage(repo, 'pkg-b', { name: '@flat/b', version: '1.0.0' });
    addPackage(repo, 'pkg-a', { description: 'Package A', name: '@flat/a' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Package A', name: '@flat/a', path: 'pkg-a' },
      { description: undefined, name: '@flat/b', path: 'pkg-b' },
    ]);
  });
});

describe('package validation', () => {
  it('silently skips workspace dirs whose package.json has no name', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    addPackage(repo, 'packages/b', { version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
  });
});

describe('deduplication', () => {
  it('deduplicates by path when patterns overlap', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), {
      workspaces: ['packages/a', 'packages/*'],
    });
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    addPackage(repo, 'packages/b', { name: '@mono/b', version: '1.0.0' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
      { description: undefined, name: '@mono/b', path: 'packages/b' },
    ]);
  });
});

describe('untrusted pattern rejection', () => {
  it('ignores a leading-.. pattern without ever reading outside the repo', async () => {
    expect.hasAssertions();
    const outerDir = freshRepo();
    const repo = join(outerDir, 'repo');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(repo);
    writeJson(join(repo, 'package.json'), { workspaces: ['../*'] });
    addPackage(outerDir, 'secret-pkg', { name: '@outside/secret', version: '1.0.0' });

    const callsBefore = readdirMock.mock.calls.length;
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
    expect(readdirMock).toHaveBeenCalledTimes(callsBefore);
  });

  it('ignores a mid-pattern .. segment without ever reading outside the repo', async () => {
    expect.hasAssertions();
    const outerDir = freshRepo();
    const repo = join(outerDir, 'repo');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(repo);
    writeJson(join(repo, 'package.json'), {
      workspaces: ['packages/../../etc/*'],
    });
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    addPackage(outerDir, 'etc/secret', { name: '@outside/secret', version: '1.0.0' });

    const callsBefore = readdirMock.mock.calls.length;
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
    expect(readdirMock).toHaveBeenCalledTimes(callsBefore);
  });

  it('ignores an absolute pattern', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['/etc/*'] });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
  });
});
