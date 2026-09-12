import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackagesDetailed, scanIsReliable } from '../src/workspaces.ts';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// What a pattern that can match at more than one depth actually finds.
//
// `packages/**/*` is the most common pnpm spelling, and until now it was reported as
// `unsupported_pattern` — which also made the whole scan unreliable, so the unregistered-package
// pass stood down for the entire ref. A repository declaring it got no answer at all, permanently.

const names = (packages: readonly { name: string }[]): string[] =>
  packages.map((pkg) => pkg.name).toSorted();

describe('a recursive workspace pattern', () => {
  it('finds packages at every depth below the base', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/shallow', { name: '@deep/shallow', version: '1.0.0' });
    addPackage(repo, 'packages/group/deeper', { name: '@deep/deeper', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(names(scan.packages)).toStrictEqual(['@deep/deeper', '@deep/shallow']);
  });

  it('keeps walking past a package it already found', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/outer', { name: '@deep/outer', version: '1.0.0' });
    addPackage(repo, 'packages/outer/inner', { name: '@deep/inner', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    // A package boundary is not a stopping condition: pnpm globs manifest paths, so a package
    // nested inside another is found exactly like any other.
    expect(names(scan.packages)).toStrictEqual(['@deep/inner', '@deep/outer']);
  });
});

describe('a recursive workspace pattern, and what it leaves out', () => {
  it('never walks into node_modules', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    addPackage(repo, 'packages/real/node_modules/left-pad', { name: 'left-pad', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    // The pattern matches that path as a STRING. Reporting it would mean reporting a repository's
    // installed dependencies as its own packages, which is what both resolvers refuse to do.
    expect(names(scan.packages)).toStrictEqual(['@deep/real']);
  });

  it('leaves a hidden directory alone unless the pattern names it', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    addPackage(repo, 'packages/.cache/pkg', { name: '@deep/cached', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    // A wildcard does not select a dot-name, and the matcher is what decides that — no separate
    // list of directories to skip, which would have to be right about dot-names twice.
    expect(names(scan.packages)).toStrictEqual(['@deep/real']);
  });

  it('walks a hidden directory the pattern does name', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/.internal/**/*'] });
    addPackage(repo, 'packages/.internal/pkg', { name: '@deep/internal', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(names(scan.packages)).toStrictEqual(['@deep/internal']);
  });
});

describe('a recursive workspace pattern, under a negation', () => {
  it('applies a negation beneath the base', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/**/*'\n  - '!packages/fixtures'\n",
    );
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    addPackage(repo, 'packages/fixtures', { name: '@deep/fixture', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(names(scan.packages)).toStrictEqual(['@deep/real']);
  });
});

describe('what the walk cannot see', () => {
  it('reports a symlinked directory that could have held a match', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });
    addPackage(repo, 'elsewhere/pkg', { name: '@deep/elsewhere', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'packages', 'linked'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'elsewhere'), join(repo, 'packages', 'link'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // `readdir` uses lstat semantics, so a symlinked directory can never be walked here. Saying
    // nothing would leave the scan looking complete while a package sat behind the link.
    expect(scan.diagnostics).toContainEqual({
      kind: 'candidate_not_inspected',
      path: 'packages/link',
    });
    expect(scanIsReliable(scan)).toBe(false);
  });
});

describe('a base directory that is not there', () => {
  it('says nothing about a declared tree the repository does not have', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // astro declares `smoke/**/*` and a fresh clone has no `smoke/`. Reporting that would mark
    // the scan unreliable on every such repository, which turns the unregistered-package pass off
    // permanently for a repository where nothing is wrong.
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/**/*', 'smoke/**/*'] });
    addPackage(repo, 'packages/real', { name: '@deep/real', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(scan.diagnostics).toStrictEqual([]);
    expect(scanIsReliable(scan)).toBe(true);
  });
});

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
