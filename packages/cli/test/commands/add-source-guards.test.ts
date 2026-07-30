import { describe, expect, it } from 'vitest';
import {
  ensureNoCaseCollision,
  refLockName,
  resolveAddSource,
} from '../../src/commands/add-source.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { dirname } from 'node:path';
import { testContext } from '../helpers/context.ts';
import { withTempHome } from '../helpers/add-support.ts';

// Guard edges of `refs add`'s source resolution that the e2e suites never hit: the bare `npm:`
// usage error, the packument `repository.directory` passthrough (a monorepo package must carry
// its directory into the proposal seeding), and `ensureNoCaseCollision`'s fs edges — a missing
// sources/ tree (fresh home) is simply "nothing to collide with", while an unexpected fs error
// (sources/ replaced by a regular file) must surface, not be swallowed as "no collision".

const MONOREPO_PACKUMENT = {
  repository: { directory: 'packages/widget', url: 'git+https://github.com/acme/mono.git' },
};

const HTTP_OK = 200;

describe('add source: refLockName', () => {
  it('derives a Windows-safe lock name (no ":", "/" replaced by "_")', () => {
    expect.hasAssertions();
    expect(refLockName(zRefKey.parse('github.com/vercel/next.js'))).toBe(
      'ref.github.com_vercel_next.js',
    );
  });
});

describe('add source: npm resolution edges', () => {
  it('rejects a bare npm: source with an actionable usage error', async () => {
    expect.hasAssertions();
    const { ctx } = testContext();
    await expect(resolveAddSource(ctx, 'npm:')).rejects.toThrow(
      'refs add npm: requires a package name, e.g. npm:left-pad',
    );
  });

  it('carries the packument repository directory through for a monorepo package', async () => {
    expect.hasAssertions();
    const { ctx } = testContext();
    ctx.fetcher = () =>
      Promise.resolve({ json: () => Promise.resolve(MONOREPO_PACKUMENT), status: HTTP_OK });
    await expect(resolveAddSource(ctx, 'npm:@acme/widget')).resolves.toStrictEqual({
      cloneUrl: 'https://github.com/acme/mono.git',
      key: 'github.com/acme/mono',
      npmDirectory: 'packages/widget',
      npmPkgName: '@acme/widget',
    });
  });
});

describe('add source: case-collision guard fs edges', () => {
  it('treats a not-yet-existing sources tree as collision-free', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = resolveHome({ REFS_HOME: homeDir });
      await expect(
        ensureNoCaseCollision(home, zRefKey.parse('github.com/acme/widget')),
      ).resolves.toBeUndefined();
    });
  });

  it('surfaces an unexpected fs error instead of reporting no collision', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = resolveHome({ REFS_HOME: homeDir });
      await mkdir(dirname(home.sourcesDir), { recursive: true });
      await writeFile(home.sourcesDir, 'not a directory\n');
      await expect(
        ensureNoCaseCollision(home, zRefKey.parse('github.com/acme/widget')),
      ).rejects.toThrow(/ENOTDIR/u);
    });
  });
});
