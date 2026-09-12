import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackages, detectWorkspacePackagesDetailed } from '../src/workspaces.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zPackagePath } from '../src/schemas/primitives.ts';

// A wildcard that does not sit in the pattern's last segment — `crates/*/js`, which `vercel/next.js`
// declares twice and which used to be refused outright. Split from `workspaces.test.ts` for the
// 300-line cap; these all go through the real filesystem, because the defect was never in
// classifying the shape but in every place that had to build the candidate's path.

describe('a wildcard that is not in the last segment', () => {
  it('registers the package at the suffixed path, not at the wildcard directory', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // The shape `vercel/next.js` declares. Classifying it is not enough: the probe has to look
    // under `<child>/js`, the diagnostic has to name that path, and the registered package path
    // has to be it — three places that used to build the path separately.
    writeJson(join(repo, 'package.json'), { workspaces: ['crates/*/js'] });
    addPackage(repo, 'crates/next-core/js', { name: '@vercel/turbopack-next', version: '1.0.0' });
    addPackage(repo, 'crates/other/js', { name: '@vercel/other', version: '1.0.0' });
    // A child without the suffix is not a package: `crates/bare` holds a manifest at its own root,
    // which this pattern does not select.
    addPackage(repo, 'crates/bare', { name: '@vercel/bare', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { name: '@vercel/turbopack-next', path: 'crates/next-core/js' },
      { name: '@vercel/other', path: 'crates/other/js' },
    ]);
  });
});

describe('a wildcard pattern written with a trailing separator', () => {
  it('expands it, and produces a path the schema accepts', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `packages/*/` reads as `packages/*` to npm and pnpm, but minimatch treats a trailing
    // separator asymmetrically — `packages/core` does not match `packages/*/`. Carrying the raw
    // pattern selected nothing AND reported nothing, which is worse than the `unsupported_pattern`
    // this shape used to get. And `*/core/` produced the path `packages/core/`, which
    // `zPackagePath` rejects outright.
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*/', '*/core/'] });
    addPackage(repo, 'packages/core', { name: '@x/core', version: '1.0.0' });

    const detected = await detectWorkspacePackages(repo);

    expect(detected).toStrictEqual([{ name: '@x/core', path: 'packages/core' }]);
    expect(zPackagePath.safeParse(detected[0]?.path).success).toBe(true);
  });

  it('names the suffixed path in a diagnostic, not the wildcard directory', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['crates/*/js'] });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'crates/broken/js'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'crates/broken/js/package.json'), '{ not json');

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(scan.diagnostics).toStrictEqual([
      { kind: 'manifest_unreadable', path: 'crates/broken/js' },
    ]);
  });

  it('matches the wildcard segment, not every child', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['crates/core*/js'] });
    addPackage(repo, 'crates/core-a/js', { name: '@x/core-a', version: '1.0.0' });
    addPackage(repo, 'crates/other/js', { name: '@x/other', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { name: '@x/core-a', path: 'crates/core-a/js' },
    ]);
  });
});
