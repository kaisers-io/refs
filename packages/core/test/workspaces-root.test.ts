import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackages, detectWorkspacePackagesDetailed } from '../src/workspaces.ts';
import { join } from 'node:path';
import { scanIsReliable } from '../src/workspaces-patterns.ts';

// The repository root as a package of its own. A workspace root is not one of its own glob
// targets, so expansion never reaches it — and a root that names itself was registered nowhere,
// which is what made a monorepo unresolvable by the name in its own manifest (#88). Split from
// `workspaces.test.ts` for the 300-line cap.

const ONE_MATCH = 1;

describe('the workspace root itself', () => {
  it('registers the root under its own name, at path "."', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // The shape the bug was reported against: a private root that names itself, and whose name is
    // therefore not one of its own glob targets. Expansion alone never reaches it.
    writeJson(join(repo, 'package.json'), {
      name: '@acme/toolkit',
      private: true,
      workspaces: ['packages/*'],
    });
    addPackage(repo, 'packages/a', { name: '@acme/a', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@acme/toolkit', path: '.' },
      { description: undefined, name: '@acme/a', path: 'packages/a' },
    ]);
  });

  it('says nothing about a root that names nothing', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { name: '@acme/a', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@acme/a', path: 'packages/a' },
    ]);
  });

  it('leaves a scan reliable when the root has no name', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { name: '@acme/a', version: '1.0.0' });

    // An unnamed root is the common case, and `manifest_missing_name` must stay out of the kinds
    // that make a scan unreliable — otherwise every drift verdict built on this scan would be
    // suppressed for most repositories.
    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(scanIsReliable(scan)).toBe(true);
  });
});

describe('the workspace root in a repo without workspaces', () => {
  it('is not probed at all', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // A single-package repo. `refs add`'s npm fallback owns this shape — it registers the package
    // at the packument's own directory — and a root probe here would suppress that fallback with
    // a locator it did not choose.
    writeJson(join(repo, 'package.json'), { name: 'single-package', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
  });
});

describe('a root whose name a workspace member also claims', () => {
  it('keeps the member and drops the root', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // Real shape: `@remix-run/react-router` is a root name in a repository that also publishes
    // `react-router` from `packages/`.
    writeJson(join(repo, 'package.json'), {
      name: '@acme/toolkit',
      private: true,
      workspaces: ['packages/*'],
    });
    addPackage(repo, 'packages/toolkit', { name: '@acme/toolkit', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@acme/toolkit', path: 'packages/toolkit' },
    ]);
  });

  it('still finds that member uniquely after it moves', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), {
      name: '@acme/toolkit',
      private: true,
      workspaces: ['packages/*'],
    });
    // The member has moved. Against a scan holding both it and the same-named root, looking it up
    // would come back ambiguous — and `resolve` would hand back no path for a package that is
    // plainly there. Dropping the claimed root is what keeps the relocation resolvable.
    addPackage(repo, 'packages/new-toolkit', { name: '@acme/toolkit', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);
    const named = scan.packages.filter((pkg) => pkg.name === '@acme/toolkit');

    expect(named).toHaveLength(ONE_MATCH);
    expect(named[0]?.path).toBe('packages/new-toolkit');
  });
});
