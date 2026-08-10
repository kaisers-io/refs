import { addPackage, asCheckout, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { resolveHome, withLock, zRefKey } from '@kaisers-io/refs-core';
import type { VerifyOutcome } from '../../src/commands/resolve-verify.ts';
import { join } from 'node:path';
import { refLockName } from '../../src/commands/add-source.ts';
import { verifyPackageLocation } from '../../src/commands/resolve-verify.ts';
import { withTempHome } from '../helpers/add-support.ts';
import { writeFileSync } from 'node:fs';

// What happens when verification runs alongside a `sync` that is mutating the same checkout.
// These are the tests that justify the locked re-probe existing at all — each one FAILS if it is
// removed, which the plain verification tests in `resolve-verify.test.ts` cannot establish.

const KEY = zRefKey.parse('github.com/colinhacks/zod');

// Holds the ref lock until the returned `release` is called, so a test can pin the exact
// interleaving: verification's lock-free probe runs while the lock is held, its rescan then has
// to wait, and only what happens before `release` is visible to the LOCKED re-probe.
const NOOP = (): void => undefined;

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let escaped = NOOP;
  // A deferred is exactly what the constructor is for: the resolver has to escape to a caller
  // that decides WHEN to settle, which async/await cannot express.
  // eslint-disable-next-line promise/avoid-new -- deferred, see above
  const promise = new Promise<void>((resolve) => {
    escaped = resolve;
  });
  return { promise, resolve: escaped };
};

const holdRefLock = async (
  home: Parameters<typeof withLock>[0],
): Promise<{ held: Promise<void>; release: () => void }> => {
  const gate = deferred();
  const acquired = deferred();
  const held = withLock(home, refLockName(KEY), async () => {
    acquired.resolve();
    await gate.promise;
  });
  await acquired.promise;
  return { held, release: gate.resolve };
};

/** Starts verification for `packages/zod` while the ref lock is held, runs `duringLock` once the
 * lock-free probe has settled against the tree as it then was, and releases. Whatever
 * `duringLock` changes is visible ONLY to the locked re-probe — which is what makes these tests
 * fail when the re-probe is removed, rather than passing through the fast path. */
const verifyAcrossLock = async (
  homeDir: string,
  repo: string,
  duringLock: () => void,
): Promise<VerifyOutcome> => {
  const home = resolveHome({ REFS_HOME: homeDir });
  const lock = await holdRefLock(home);
  const probed = deferred();
  const inFlight = verifyPackageLocation({
    checkoutDir: repo,
    configuredPath: 'packages/zod',
    home,
    key: KEY,
    onProbed: probed.resolve,
    packageName: 'zod',
  });
  // Wait for the OBSERVED completion of the lock-free probe, not for elapsed time. Sleeping
  // instead would make these tests pass for the wrong reason: a probe still running when the
  // package is restored would see it itself and return the expected answer through the fast
  // path, so the locked re-probe could be deleted without either test noticing.
  await probed.promise;
  duringLock();
  lock.release();
  await lock.held;
  return inFlight;
};

describe('racing a sync', () => {
  it('re-probes under the lock and reports verified when the race resolved itself', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['src/*'] });
      addPackage(repo, 'src/other', { name: 'other' });

      // `verified` is only reachable through the LOCKED re-probe: the fast path saw nothing at
      // `packages/zod`, and the scan cannot see it either — no workspace pattern covers it.
      // Delete the re-probe and this returns `missing`.
      const outcome = await verifyAcrossLock(homeDir, repo, () => {
        addPackage(repo, 'packages/zod', { name: 'zod' });
      });
      expect(outcome).toStrictEqual({ path: 'packages/zod', status: 'verified' });
    });
  });
});

describe('racing a sync that leaves something unreadable', () => {
  it('reports unverifiable when the locked re-probe finds the manifest unreadable', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['src/*'] });

      const outcome = await verifyAcrossLock(homeDir, repo, () => {
        // A sync that left the path occupied by something unreadable rather than by a package.
        addPackage(repo, 'packages/zod', { name: 'zod' });
        // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
        writeFileSync(join(repo, 'packages', 'zod', 'package.json'), '{ broken');
      });
      expect(outcome.status).toBe('unverifiable');
      expect(outcome.path).toBe('packages/zod');
    });
  });
});

describe('a ref lock that cannot be acquired', () => {
  it('reports unverifiable — never missing — when the ref lock cannot be acquired', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const repo = asCheckout(freshRepo());
      writeJson(join(repo, 'package.json'), { name: 'monorepo', workspaces: ['src/*'] });
      const home = resolveHome({ REFS_HOME: homeDir });
      // Lock contention must degrade to "could not check", never to a command error and never to
      // "the package is gone".
      const outcome = await withLock(home, refLockName(KEY), () =>
        verifyPackageLocation({
          checkoutDir: repo,
          configuredPath: 'packages/zod',
          home,
          key: KEY,
          lockTimeoutMs: 50,
          packageName: 'zod',
        }),
      );
      expect(outcome.status).toBe('unverifiable');
      expect(outcome.path).toBe('packages/zod');
    });
  });
});
