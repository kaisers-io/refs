import { addPackage, freshRepo } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackagesDetailed, scanIsReliable } from '../src/workspaces.ts';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// What an EXCLUSION does and does not reach. Every case here is one where the obvious reading —
// "the repository excluded that, so nothing under it matters" — is wrong, and acting on it makes
// an incomplete scan report itself complete.

const names = (packages: readonly { name: string }[]): string[] =>
  packages.map((pkg) => pkg.name).toSorted();

describe('what counts as excluding a whole subtree', () => {
  it('keeps a package below a single-level exclusion', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/**'\n  - '!packages/group/*'\n",
    );
    addPackage(repo, 'packages/group/child/deep', { name: '@deep/deep', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    // `!packages/group/*` excludes one level, not the tree. Deciding otherwise by asking
    // `minimatch('packages/group/**', 'packages/group/*')` looks equivalent and is not: `**` is
    // ordinary text in the SUBJECT, so a single-level exclusion would prune every descendant it
    // does not exclude — silently, with the scan still reporting itself complete.
    expect(names(scan.packages)).toStrictEqual(['@deep/deep']);
    expect(scanIsReliable(scan)).toBe(true);
  });
});

describe('an exclusion that does not reach a hidden descendant', () => {
  it('keeps walking for a pattern that names one outright', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*/.internal/**'\n  - '!packages/group/**'\n",
    );
    addPackage(repo, 'packages/group/.internal/pkg', { name: '@deep/internal', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    // A wildcard exclusion does not cover a hidden segment — minimatch skips dot-names unless the
    // pattern says otherwise — so the package is selected and not excluded. Pruning its ancestor
    // on the strength of that exclusion would drop a package nothing excluded.
    expect(names(scan.packages)).toStrictEqual(['@deep/internal']);
  });
});

describe('a symlink whose exclusion covers only itself', () => {
  it('is still reported, because what is below it is not excluded', async () => {
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

    // `packages/linked/pkg` is selected and excluded by nothing, so a package could be sitting
    // behind that link. Staying quiet would let it certify a scan that never looked.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'candidate_not_inspected', path: 'packages/linked' },
    ]);
  });
});

describe('a symlink an exclusion cannot reach past', () => {
  it('is reported when the pattern names a hidden segment', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*/.internal/**'\n  - '!packages/group/**'\n",
    );
    addPackage(repo, 'elsewhere/.internal/pkg', { name: '@deep/internal', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'packages'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(join(repo, 'elsewhere'), join(repo, 'packages', 'group'), 'dir');

    const scan = await detectWorkspacePackagesDetailed(repo);

    // The wildcard exclusion does not cover a hidden segment, so `packages/group/.internal/pkg`
    // is selected and excluded by nothing. Answering "is this subtree excluded?" one way for
    // walking and another for reporting is how a skipped link certifies a scan that never looked.
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'candidate_not_inspected', path: 'packages/group' },
    ]);
  });
});
