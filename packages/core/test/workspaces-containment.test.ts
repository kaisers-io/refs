import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { detectWorkspacePackages } from '../src/workspaces.ts';
import { join } from 'node:path';

// Wraps the real `readdir`/`readFile` in spies so tests can assert no filesystem read is
// attempted for a path that escapes the repo, while all other tests keep the real behavior.
vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  // `readdir`/`readFile` are heavily overloaded; vi.fn's inferred mock type can't reproduce
  // every overload, so the mocks are cast back to the original signature after wrapping them.
  const readdirSpy = vi.fn<typeof actual.readdir>(
    actual.readdir as never,
  ) as unknown as typeof actual.readdir;
  const readFileSpy = vi.fn<typeof actual.readFile>(
    actual.readFile as never,
  ) as unknown as typeof actual.readFile;
  return { ...actual, readFile: readFileSpy, readdir: readdirSpy };
});

const readdirMock = vi.mocked(readdir);
const readFileMock = vi.mocked(readFile);
const FIRST_ARG_INDEX = 0;

// True if any recorded call's first argument (a path) falls under `targetDir`.
const touchedPathUnder = (calls: unknown[][], targetDir: string): boolean =>
  calls.some((args) => String(args[FIRST_ARG_INDEX]).startsWith(targetDir));

describe('symlink containment', () => {
  it('skips a symlinked package dir that escapes the repo', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const outside = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { description: 'Package A', name: '@mono/a' });
    writeJson(join(outside, 'package.json'), { description: 'Outside', name: '@outside/pkg' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(repo, 'packages', 'b'));
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Package A', name: '@mono/a', path: 'packages/a' },
    ]);
  });

  it('skips a glob base dir that is itself a symlink escaping the repo, never reading it', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const outside = freshRepo();
    const linkedBaseDir = join(repo, 'packages');
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(outside, 'nested', { name: '@outside/nested', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, linkedBaseDir);

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
    // The symlinked base dir itself must never be handed to readdir/readFile: the
    // containment check has to run before any read of the directory it points to.
    expect(touchedPathUnder(readdirMock.mock.calls, linkedBaseDir)).toBe(false);
    expect(touchedPathUnder(readFileMock.mock.calls, linkedBaseDir)).toBe(false);
  });

  it('skips a non-glob dir that is itself a symlink escaping the repo, never reading it', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const outside = freshRepo();
    const linkedDir = join(repo, 'linked');
    writeJson(join(repo, 'package.json'), { workspaces: ['linked'] });
    writeJson(join(outside, 'package.json'), { description: 'Outside', name: '@outside/pkg' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, linkedDir);

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
    // The symlinked dir itself must never be handed to readFile: the containment check
    // has to run before any read of the file it points to.
    expect(touchedPathUnder(readFileMock.mock.calls, linkedDir)).toBe(false);
  });
});

describe('containment fixes (round 3)', () => {
  it('skips a package whose package.json itself is a symlink escaping the repo, never reading it', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const outside = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'packages', 'a'), { recursive: true });
    const externalManifest = join(outside, 'external-package.json');
    writeJson(externalManifest, { description: 'Outside', name: '@outside/pkg' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(externalManifest, join(repo, 'packages', 'a', 'package.json'));

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
    // The external manifest's content must never be read: containment on the
    // package.json FILE path has to be checked before readFile follows the symlink.
    expect(touchedPathUnder(readFileMock.mock.calls, externalManifest)).toBe(false);
  });

  it('detects a package in a directory literally named "..packages" (not a parent escape)', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['..packages'] });
    addPackage(repo, '..packages', { description: 'Dotdot-prefixed dir', name: '@mono/dotdot' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: 'Dotdot-prefixed dir', name: '@mono/dotdot', path: '..packages' },
    ]);
  });
});

describe('containment fixes (round 4)', () => {
  it('skips a root package.json that is itself a symlink escaping the repo', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const outside = freshRepo();
    const rootPackageJsonPath = join(repo, 'package.json');
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    writeJson(join(outside, 'external-package.json'), {
      name: 'outside-root',
      workspaces: ['packages/*'],
    });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(outside, 'external-package.json'), rootPackageJsonPath);

    // Pre-fix, the symlinked root package.json's `workspaces` field would leak through
    // and cause `packages/a` to be detected; the fix must yield an empty result instead.
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
    // Containment on the root package.json FILE path has to be checked before
    // readFile is ever called on it, so the guarded path itself is never touched.
    expect(touchedPathUnder(readFileMock.mock.calls, rootPackageJsonPath)).toBe(false);
  });

  it('skips a root pnpm-workspace.yaml that is itself a symlink escaping the repo', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    const outside = freshRepo();
    const rootPnpmWorkspacePath = join(repo, 'pnpm-workspace.yaml');
    writeJson(join(repo, 'package.json'), { name: 'monorepo' });
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(outside, 'external-pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(outside, 'external-pnpm-workspace.yaml'), rootPnpmWorkspacePath);

    // Pre-fix, the symlinked pnpm-workspace.yaml's patterns would leak through and
    // cause `packages/a` to be detected; the fix must yield an empty result instead.
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
    // Containment on the root pnpm-workspace.yaml FILE path has to be checked before
    // readFile is ever called on it, so the guarded path itself is never touched.
    expect(touchedPathUnder(readFileMock.mock.calls, rootPnpmWorkspacePath)).toBe(false);
  });
});
