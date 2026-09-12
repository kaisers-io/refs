import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackagesDetailed, scanIsReliable } from '../src/workspaces.ts';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
