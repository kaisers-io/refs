import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackages, detectWorkspacePackagesDetailed } from '../src/workspaces.ts';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanIsReliable } from '../src/workspaces-patterns.ts';

// Diagnostics exist so a consumer can tell "nothing found because nothing is there" from
// "nothing found because something failed". Every case below produces the same empty or partial
// package list that detection has always produced — the diagnostic is the only thing that
// distinguishes them, and `scanIsReliable` is what stops an incomplete scan from being read as
// evidence that packages were removed.
//
// SCOPE LIMIT, deliberate: `workspace_file_unreadable` means the declaration could not be READ
// (I/O error, containment rejection) or, for `package.json`, could not be parsed as JSON. It
// does NOT mean "malformed YAML" — `collectPnpmPatterns` is a line parser, so plenty of invalid
// YAML parses as empty or partial with nothing to report.

describe('scans with nothing wrong', () => {
  it('reports no_workspace_declaration for a repo with no workspaces, and stays reliable', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'solo', version: '1.0.0' });
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan).toStrictEqual({
      diagnostics: [{ kind: 'no_workspace_declaration' }],
      packages: [],
    });
    // This is the case that must NOT be a failure: most repos look like this.
    expect(scanIsReliable(scan)).toBe(true);
  });

  it('reports nothing at all for a clean monorepo', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { name: '@mono/a' });
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });

  it('stays reliable when a named base directory does not exist yet', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `packages/*` before `packages/` is created is ordinary, not a failure.
    writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['packages/*'] });
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });
});

describe('unreadable workspace declarations', () => {
  it('reports workspace_file_unreadable for a malformed root package.json', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'package.json'), '{ not json');
    const scan = await detectWorkspacePackagesDetailed(repo);
    // Sorted, not push order: 'no_workspace_declaration' sorts before 'workspace_file_unreadable'.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'no_workspace_declaration' },
      { file: 'package.json', kind: 'workspace_file_unreadable' },
    ]);
    expect(scanIsReliable(scan)).toBe(false);
  });

  it('reports workspace_file_unreadable for an unreadable pnpm-workspace.yaml', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'monorepo' });
    // A directory where the file should be. The read rejects on all three CI platforms; the
    // precise system error is platform-dependent, so this asserts the diagnostic, not an errno.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'pnpm-workspace.yaml'), { recursive: true });
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan.diagnostics).toContainEqual({
      file: 'pnpm-workspace.yaml',
      kind: 'workspace_file_unreadable',
    });
    expect(scanIsReliable(scan)).toBe(false);
  });
});

describe('incomplete expansion', () => {
  it('reports unsupported_pattern for a pattern the classifier ignores', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), {
      name: 'monorepo',
      workspaces: ['packages/*', 'libs/**/deep'],
    });
    addPackage(repo, 'packages/a', { name: '@mono/a' });
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan.packages).toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'unsupported_pattern', pattern: 'libs/**/deep' },
    ]);
    // A package could be hiding behind the ignored pattern, so the scan is not complete.
    expect(scanIsReliable(scan)).toBe(false);
  });
});

describe('unusable package candidates', () => {
  it('reports manifest_unreadable for a candidate whose package.json is malformed', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['packages/*'] });
    addPackage(repo, 'packages/good', { name: '@mono/good' });
    addPackage(repo, 'packages/bad', { name: '@mono/bad' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'packages', 'bad', 'package.json'), '{ broken');
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan.packages).toStrictEqual([
      { description: undefined, name: '@mono/good', path: 'packages/good' },
    ]);
    expect(scan.diagnostics).toStrictEqual([{ kind: 'manifest_unreadable', path: 'packages/bad' }]);
    expect(scanIsReliable(scan)).toBe(false);
  });

  it('reports manifest_missing_name for a nameless manifest, and stays reliable', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['packages/*'] });
    addPackage(repo, 'packages/nameless', { private: true, version: '1.0.0' });
    const scan = await detectWorkspacePackagesDetailed(repo);
    // The manifest read fine — it just is not a package. Saying "unreadable" would tell an agent
    // something failed when nothing did, and marking the SCAN unreliable would be worse still:
    // one nameless package.json under a glob would suppress every removal detection for this
    // repo forever. The observation is complete; it simply found no package here.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'manifest_missing_name', path: 'packages/nameless' },
    ]);
    expect(scanIsReliable(scan)).toBe(true);
  });
});

// One in-repo monorepo with a single package, plus an unrelated repo outside it to point at.
const seedMonorepoWithOutside = (): { outside: string; repo: string } => {
  const repo = freshRepo();
  const outside = freshRepo();
  writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['packages/*'] });
  addPackage(repo, 'packages/a', { name: '@mono/a' });
  writeJson(join(outside, 'package.json'), { name: '@outside/pkg' });
  return { outside, repo };
};

describe('candidates behind symlinks', () => {
  it('reports manifest_unreadable when a candidate manifest is symlinked outside', async () => {
    expect.hasAssertions();
    const { outside, repo } = seedMonorepoWithOutside();
    // A real directory whose package.json points out of the repo. The manifest is refused
    // without being read, and the refusal is now visible instead of silently emptying the scan.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'packages', 'b'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(outside, 'package.json'), join(repo, 'packages', 'b', 'package.json'));
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan.packages).toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
    expect(scan.diagnostics).toStrictEqual([{ kind: 'manifest_unreadable', path: 'packages/b' }]);
    expect(scanIsReliable(scan)).toBe(false);
  });

  it('admits that a symlinked candidate directory was never inspected', async () => {
    expect.hasAssertions();
    const { outside, repo } = seedMonorepoWithOutside();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(repo, 'packages', 'b'));
    const scan = await detectWorkspacePackagesDetailed(repo);
    // `readdir` uses lstat semantics, so a symlinked directory is not `isDirectory()` and never
    // becomes a candidate — it stays excluded from `packages`, exactly as before. What changed
    // is that the omission is now VISIBLE: callers infer "this package is gone" and "this is its
    // one new home" from a scan, and neither conclusion is safe while a possible package sits
    // unexamined behind a link.
    expect(scan.packages).toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'candidate_not_inspected', path: 'packages/b' },
    ]);
    expect(scanIsReliable(scan)).toBe(false);
  });
});

describe('symlinks that are not candidates', () => {
  it('stays silent about a symlink that is not a package candidate at all', async () => {
    expect.hasAssertions();
    const { repo } = seedMonorepoWithOutside();
    // A link to something with no manifest is not a missed package. Reporting it would make
    // every incidental link in a monorepo suppress removal detection.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'notes'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'notes'), join(repo, 'packages', 'link-to-notes'));
    const scan = await detectWorkspacePackagesDetailed(repo);
    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });
});

describe('the plain wrapper add consumes', () => {
  it('still returns a bare array, dropping diagnostics', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { name: '@mono/a' });
    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
  });
});
