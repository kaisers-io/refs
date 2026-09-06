import { addPackage, freshRepo } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackages, detectWorkspacePackagesDetailed } from '../src/workspaces.ts';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Negated workspace patterns: what they exclude, what they cannot express, and why an exclusion
// is resolved before any manifest is opened. Split from `workspaces.test.ts` for the 300-line cap.

describe('negation patterns', () => {
  it('subtracts a glob negation from what the inclusive patterns selected', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - tools/*\n  - '!tools/*'\n",
    );
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    addPackage(repo, 'tools/t1', { name: '@mono/t1', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
  });

  it('excludes only what the negation actually matches, not what shares its prefix', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // The reason this is expansion rather than a string-prefix test: `packages/fixture-live` does
    // not match `!packages/fixture`, and treating it as excluded would have reported a live
    // package as gone.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/fixture'\n",
    );
    addPackage(repo, 'packages/fixture', { name: '@mono/fixture', version: '1.0.0' });
    addPackage(repo, 'packages/fixture-live', { name: '@mono/live', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/live', path: 'packages/fixture-live' },
    ]);
  });
});

describe('negation patterns with a wildcard inside a segment', () => {
  it('applies it, the shape real repos exclude by', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // TanStack Query's own declaration, reduced: `examples/vue/*` minus two prefixes.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - examples/vue/*\n  - '!examples/vue/2*'\n  - '!examples/vue/nuxt*'\n",
    );
    addPackage(repo, 'examples/vue/2.6-basic', { name: '@mono/vue26', version: '1.0.0' });
    addPackage(repo, 'examples/vue/nuxt3', { name: '@mono/nuxt3', version: '1.0.0' });
    addPackage(repo, 'examples/vue/basic', { name: '@mono/basic', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { description: undefined, name: '@mono/basic', path: 'examples/vue/basic' },
    ]);
  });
});

describe('negation patterns and unreadable manifests', () => {
  it('reports nothing about a directory the repository excluded', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/excluded'\n",
    );
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });
    // A manifest that cannot be read. Probing it yields `manifest_unreadable`, and ONE such
    // diagnostic marks the whole scan unreliable — which would silence every finding about this
    // repository over a directory it told us to ignore. Exclusions are resolved before probing so
    // the candidate is never opened.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(repo, 'packages/excluded'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    symlinkSync(
      join(repo, 'nowhere', 'package.json'),
      join(repo, 'packages/excluded/package.json'),
    );

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(scan.diagnostics).toStrictEqual([]);
    expect(scan.packages).toStrictEqual([
      { description: undefined, name: '@mono/a', path: 'packages/a' },
    ]);
  });
});

describe('negation patterns nobody can expand', () => {
  it('reports the shape rather than silently leaving the directory in', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `{a,b}` is glob syntax this scanner does not implement. Read as a literal it names a
    // directory that does not exist, so the exclusion silently does nothing — and the scan then
    // holds a package the repository declared out of scope, with no diagnostic to say so.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/{a,b}'\n",
    );
    addPackage(repo, 'packages/a', { name: '@mono/a', version: '1.0.0' });

    const scan = await detectWorkspacePackagesDetailed(repo);

    expect(scan.packages).toHaveLength(1);
    expect(scan.diagnostics).toStrictEqual([
      { kind: 'unsupported_pattern', pattern: '!packages/{a,b}' },
    ]);
  });
});
