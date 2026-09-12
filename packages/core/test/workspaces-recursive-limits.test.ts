import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackagesDetailed, scanIsReliable } from '../src/workspaces.ts';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The second half of `workspaces-recursive.test.ts`: what the walk refuses to walk, and what it
// refuses to complain about. Split for the 300-line cap.

const names = (packages: readonly { name: string }[]): string[] =>
  packages.map((pkg) => pkg.name).toSorted();

describe('a base directory that leaves the checkout', () => {
  it('is refused rather than walked', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const outside = mkdtempSync(join(tmpdir(), 'refs-outside-'));
    addPackage(outside, 'secret', { name: '@outside/secret', version: '1.0.0' });
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(repo, 'packages'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // `readdir` FOLLOWS a symlinked base, so without a containment check the whole tree out there
    // is walked. The manifest probe refuses each file it finds, which turns an escape into a list
    // of complaints about paths that are not in the repository — and into silence when the target
    // holds no manifests at all.
    expect(scan.packages).toStrictEqual([]);
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'workspace_dir_unreadable', path: 'packages' },
    ]);
  });
});

describe('symlinks that are not missed candidates', () => {
  it('says nothing about a symlinked file', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'README.md'), '# hi');
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'README.md'), join(repo, 'packages', 'README.md'));

    const scan = await detectWorkspacePackagesDetailed(repo);

    // A link to a file is not a package the walk missed, and an unreliable scan turns the whole
    // unregistered-package pass off — a repository with one symlinked README would lose it
    // permanently.
    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });

  it('says nothing about a symlinked node_modules', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'elsewhere'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'elsewhere'), join(repo, 'packages', 'node_modules'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // A directory that is never walked cannot be a directory the walk failed to inspect.
    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });
});

describe('a symlink that leaves the checkout', () => {
  it('says nothing about a link pointing out of the checkout', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const outside = mkdtempSync(join(tmpdir(), 'refs-outside-'));
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(outside, join(repo, 'packages', 'linked-out'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // An outside path is one `resolve` would refuse anyway, so nothing in the repository was
    // missed by not walking it.
    expect(scan.diagnostics).toStrictEqual([]);
  });
});

describe('a pattern ending in **', () => {
  it('selects the base directory it names, not only what is below it', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/core/**'] });
    addPackage(repo, 'packages/core', { name: '@deep/core', version: '1.0.0' });
    addPackage(repo, 'packages/core/sub', { name: '@deep/sub', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    // `**` matches zero segments before the manifest, so `packages/core/**` names
    // `packages/core/package.json` too. Verified against `@npmcli/map-workspaces` itself, which
    // reports both — matching the DIRECTORY path instead drops the first, which is the package
    // the pattern most obviously names.
    expect(names(scan.packages)).toStrictEqual(['@deep/core', '@deep/sub']);
  });

  it('selects the base of a bare ** under a directory', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**'] });
    addPackage(repo, 'packages', { name: '@deep/packages-root', version: '1.0.0' });
    addPackage(repo, 'packages/a', { name: '@deep/a', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(names(scan.packages)).toStrictEqual(['@deep/a', '@deep/packages-root']);
  });
});

describe('an excluded symlink', () => {
  it('does not make the scan unreliable', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/**/*'\n  - '!packages/linked'\n",
    );
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    addPackage(repo, 'elsewhere/pkg', { name: '@deep/elsewhere', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'elsewhere'), join(repo, 'packages', 'linked'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // The repository said it does not want what is behind that link, so not looking costs
    // nothing — and an unreliable scan would turn the unregistered-package pass off for the
    // whole ref over a directory nobody asked about.
    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });
});

describe('pruning, which asks a different question from selection', () => {
  it('walks past an ancestor that is not itself a package', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*/nested/*'] });
    addPackage(repo, 'packages/a/nested/pkg', { name: '@deep/nested', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    // Selection asks about the MANIFEST path; pruning has to ask about the directory prefix.
    // Asking the manifest question while pruning compares `packages/a/package.json` against
    // `packages/*/nested/*/package.json` — false — and skips the whole subtree below it, while
    // the scan still reports itself complete.
    expect(names(scan.packages)).toStrictEqual(['@deep/nested']);
    expect(scanIsReliable(scan)).toBe(true);
  });

  it('walks a wildcard that sits in the first segment', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['*/core/**'] });
    addPackage(repo, 'packages/core', { name: '@deep/core', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(names(scan.packages)).toStrictEqual(['@deep/core']);
  });
});
