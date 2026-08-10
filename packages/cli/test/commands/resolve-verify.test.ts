import { addPackage, asCheckout, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { verifyPackageLocation } from '../../src/commands/resolve-verify.ts';
import { withTempHome } from '../helpers/add-support.ts';
import { writeFileSync } from 'node:fs';

// `resolve` is the hot path of every agent question. These tests pin the one guarantee that
// matters: it never hands back a directory holding a DIFFERENT package than the one asked for,
// and it never turns a read failure or lock contention into a false "not found".

const KEY = zRefKey.parse('github.com/colinhacks/zod');

// The product emits `null` (not `undefined`) for "no known location" — it is a cross-process
// JSON contract, so the tests have to assert the same literal.
// eslint-disable-next-line unicorn/no-null -- matches the JSON contract under test
const NO_PATH = null;

const verifyIn = (opts: {
  checkoutDir: string;
  configuredPath: string;
  homeDir: string;
  packageName?: string;
}) =>
  verifyPackageLocation({
    checkoutDir: opts.checkoutDir,
    configuredPath: opts.configuredPath,
    home: resolveHome({ REFS_HOME: opts.homeDir }),
    key: KEY,
    packageName: opts.packageName ?? 'zod',
  });

describe('a package where the config says it is', () => {
  it('returns verified and the configured path when the name matches', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      addPackage(repo, 'packages/zod', { name: 'zod' });
      await expect(
        verifyIn({ checkoutDir: repo, configuredPath: 'packages/zod', homeDir }),
      ).resolves.toStrictEqual({
        path: 'packages/zod',
        status: 'verified',
      });
    });
  });

  it('verifies a single-package repo configured at "."', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), { name: 'left-pad' });
      await expect(
        verifyIn({
          checkoutDir: repo,
          configuredPath: '.',
          homeDir,
          packageName: 'left-pad',
        }),
      ).resolves.toStrictEqual({
        path: '.',
        status: 'verified',
      });
    });
  });
});

describe('packages workspace detection cannot see', () => {
  it('verifies a packument-directory package no workspace pattern covers', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      // No `workspaces` field anywhere — this entry came from add's npm fallback. The workspace
      // scan will never see it, so if verification did not probe the configured path FIRST this
      // would report `missing`.
      writeJson(join(repo, 'package.json'), { name: 'the-repo' });
      addPackage(repo, 'src/thing', { name: 'thing' });
      await expect(
        verifyIn({
          checkoutDir: repo,
          configuredPath: 'src/thing',
          homeDir,
          packageName: 'thing',
        }),
      ).resolves.toStrictEqual({
        path: 'src/thing',
        status: 'verified',
      });
    });
  });
});

describe('a package that moved', () => {
  it('relocates when the new location is unique', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['src/*'] });
      addPackage(repo, 'src/zod', { name: 'zod' });
      await expect(
        verifyIn({ checkoutDir: repo, configuredPath: 'packages/zod', homeDir }),
      ).resolves.toStrictEqual({
        configuredPath: 'packages/zod',
        path: 'src/zod',
        status: 'relocated',
      });
    });
  });

  it('relocates when another package has taken over the configured path', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), {
        name: 'monorepo',
        workspaces: ['packages/*', 'src/*'],
      });
      addPackage(repo, 'packages/zod', { name: '@zod/legacy' });
      addPackage(repo, 'src/zod', { name: 'zod' });
      // The silent-wrong-answer case: without verification, resolve returns packages/zod and the
      // agent reads @zod/legacy while answering a question about zod. Nothing would surface it.
      await expect(
        verifyIn({ checkoutDir: repo, configuredPath: 'packages/zod', homeDir }),
      ).resolves.toStrictEqual({
        configuredPath: 'packages/zod',
        path: 'src/zod',
        status: 'relocated',
      });
    });
  });
});

describe('a package that cannot be located', () => {
  it('reports ambiguous, with candidates, when the name exists twice', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), {
        name: 'monorepo',
        workspaces: ['legacy/*', 'src/*'],
      });
      addPackage(repo, 'src/zod', { name: 'zod' });
      addPackage(repo, 'legacy/zod', { name: 'zod' });
      await expect(
        verifyIn({ checkoutDir: repo, configuredPath: 'packages/zod', homeDir }),
      ).resolves.toStrictEqual({
        candidates: ['legacy/zod', 'src/zod'],
        configuredPath: 'packages/zod',
        path: NO_PATH,
        status: 'ambiguous',
      });
    });
  });

  it('reports missing when the name is nowhere and the scan is reliable', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['src/*'] });
      addPackage(repo, 'src/other', { name: 'other' });
      await expect(
        verifyIn({ checkoutDir: repo, configuredPath: 'packages/zod', homeDir }),
      ).resolves.toStrictEqual({
        configuredPath: 'packages/zod',
        path: NO_PATH,
        status: 'missing',
      });
    });
  });
});

describe('a package that cannot be checked', () => {
  it('reports unverifiable — never missing — when the scan is unreliable', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), {
        name: 'monorepo',
        workspaces: ['src/*', 'libs/**/deep'],
      });
      addPackage(repo, 'src/other', { name: 'other' });
      // An ignored pattern means a package could be hiding behind it, so "not found" is not a
      // fact. Reporting `missing` here would be a confident lie.
      const outcome = await verifyIn({
        checkoutDir: repo,
        configuredPath: 'packages/zod',
        homeDir,
      });
      expect(outcome.status).toBe('unverifiable');
      expect(outcome.path).toBe('packages/zod');
    });
  });
});

describe('an incomplete scan proves nothing either way', () => {
  it('refuses to call a unique match relocated when the scan was incomplete', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      // `zod` is visible at exactly one path — but an ignored pattern means another one could be
      // hiding behind it. "Found once" is only unique if everything was actually inspected;
      // picking the copy we happened to see is precisely the silent-wrong-directory failure this
      // whole feature exists to prevent.
      writeJson(join(repo, 'package.json'), {
        name: 'monorepo',
        workspaces: ['src/*', 'libs/**/deep'],
      });
      addPackage(repo, 'src/zod', { name: 'zod' });
      const outcome = await verifyIn({
        checkoutDir: repo,
        configuredPath: 'packages/zod',
        homeDir,
      });
      expect(outcome.status).toBe('unverifiable');
      expect(outcome.path).toBe('packages/zod');
    });
  });
});

describe('a repo with nowhere to search', () => {
  it('refuses to report missing when the repo declares no workspaces at all', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      // The shape `add`'s npm fallback produces: a package registered by packument `directory`
      // in a repo with no workspace declaration. The scan has nowhere to look, so its empty
      // result is reliable AND worthless as evidence — and the package really is still here,
      // one directory over. Reporting `missing` would be a definite answer from zero inspection.
      writeJson(join(repo, 'package.json'), { name: 'the-repo' });
      addPackage(repo, 'src/thing', { name: 'thing' });
      const outcome = await verifyIn({
        checkoutDir: repo,
        configuredPath: 'lib/thing',
        homeDir,
        packageName: 'thing',
      });
      expect(outcome.status).toBe('unverifiable');
      expect(outcome.path).toBe('lib/thing');
    });
  });

  it('keeps the configured path when the manifest is unreadable', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      addPackage(repo, 'packages/zod', { name: 'zod' });
      // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
      writeFileSync(join(repo, 'packages', 'zod', 'package.json'), '{ broken');
      const outcome = await verifyIn({
        checkoutDir: repo,
        configuredPath: 'packages/zod',
        homeDir,
      });
      expect(outcome.status).toBe('unverifiable');
      expect(outcome.path).toBe('packages/zod');
    });
  });
});

describe('a checkout that is not there', () => {
  it('reports unmaterialized, without probing, when the checkout is absent', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const absent = join(homeDir, 'sources', 'nothing-here');
      // The skill's recovery flow depends on this: resolve reports missing, the skill syncs, sync
      // re-clones. Probing an absent checkout would report `missing` and break it.
      await expect(
        verifyIn({ checkoutDir: absent, configuredPath: 'packages/zod', homeDir }),
      ).resolves.toStrictEqual({
        path: 'packages/zod',
        status: 'unmaterialized',
      });
    });
  });
});
