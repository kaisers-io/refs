import { addPackage, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { MemberDiscovery } from '../../src/commands/drift-discovery.ts';
import type { PackageEntry } from '@kaisers-io/refs-core';
import { driftLines } from '../../src/commands/drift-report.ts';
import { join } from 'node:path';
import { probeRefStructure } from '../../src/commands/drift-probe.ts';

// What the probe says when it could NOT look — the half of `drift-report.ts`'s second rule ("a
// failure to look is never evidence") that the discovery passes used to get wrong. They declined
// correctly and then reported nothing, so `doctor` answered `ok` while an unregistered package sat
// in the checkout. Split from `drift-unregistered-hazards.test.ts` for the 300-line cap.

const FIXTURE_REF = 'github.com/acme/alpha';

const entry = (path: string): PackageEntry => ({ description: 'A fixture package.', path });

const ALL: MemberDiscovery = { kind: 'all' };
const CONFIGURED = { '@fixture/a': entry('packages/a') };

/** A repository with one unreadable manifest that nothing else depends on — the ordinary way a
 * scan becomes unreliable, and the one measured against the built bundle in #104. */
const repoWithBrokenManifest = (): string => {
  const repo = freshRepo();
  writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(repo, 'packages/broken'), { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(repo, 'packages/broken/package.json'), '{ not json');
  return repo;
};

const OBSTACLE = 'packages/broken: manifest_unreadable';

describe('probeRefStructure: a scan the obstacle stopped', () => {
  it('names no package while an unreadable manifest could hide a duplicate name', async () => {
    expect.hasAssertions();
    // A second declaration of `@fixture/b` could be sitting behind the unreadable manifest.
    // `refs add` keeps the LAST of a duplicate pair, so naming `packages/b` from a partial view
    // would prescribe something registration might not do.
    const repo = repoWithBrokenManifest();
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    addPackage(repo, 'packages/b', { name: '@fixture/b', version: '1.0.0' });

    const report = await probeRefStructure(repo, { packages: CONFIGURED }, ALL);

    // Naming no package is right; answering `ok` was not. "Nothing is unregistered" and "the
    // search was called off" send the reader to different places, and the obstacle names the file
    // to fix rather than leaving them to find it.
    expect(report).toStrictEqual({
      discovery_incomplete: OBSTACLE,
      status: 'unknown',
    });
  });
});

describe('probeRefStructure: how a stopped scan reads', () => {
  it('reads as a line naming the file that stopped it', async () => {
    expect.hasAssertions();
    const repo = repoWithBrokenManifest();
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });

    const report = await probeRefStructure(repo, { packages: CONFIGURED }, ALL);

    expect(driftLines(report, FIXTURE_REF)).toStrictEqual([
      `could not check for unregistered packages — ${OBSTACLE}`,
    ]);
  });
});

describe('probeRefStructure: what an obstacle does not cost', () => {
  it('keeps the configured half’s own finding alongside the obstacle', async () => {
    expect.hasAssertions();
    // `@fixture/a` is configured and its path holds nothing. The answer is `unverifiable` rather
    // than `missing`: settling "gone" also needs the scan, and this one could have missed a
    // relocation behind the unreadable manifest. Asserting the status, not a count — a count would
    // pass for any finding at all.
    const repo = repoWithBrokenManifest();
    addPackage(repo, 'packages/other', { name: '@fixture/other', version: '1.0.0' });

    const report = await probeRefStructure(repo, { packages: CONFIGURED }, ALL);

    expect(report.discovery_incomplete).toBe(OBSTACLE);
    expect(report.packages?.map((issue) => [issue.name, issue.status])).toStrictEqual([
      ['@fixture/a', 'unverifiable'],
    ]);
    expect(report.status).toBe('unknown');
  });

  it('makes no drift claim at all while the obstacle stands', async () => {
    expect.hasAssertions();
    // Two declarations of the configured name. With a reliable scan this is `ambiguous`, a drift
    // status; with an unreadable manifest in the repository it is `unverifiable` instead, because
    // `package-location.ts` refuses to settle any location against an incomplete scan. So an
    // obstacle and a drift claim cannot co-occur — a failure to look is never evidence, which is
    // this vocabulary's own second rule.
    const repo = repoWithBrokenManifest();
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    addPackage(repo, 'packages/a-copy', { name: '@fixture/a', version: '1.0.0' });

    const report = await probeRefStructure(repo, { packages: CONFIGURED }, ALL);

    expect(report.status).toBe('unknown');
    expect(report.discovery_incomplete).toBe(OBSTACLE);
  });
});

describe('probeRefStructure: a sync-shaped probe that reached the scan', () => {
  it('reports the obstacle on an arrivals probe whose range did change a manifest', async () => {
    expect.hasAssertions();
    const repo = repoWithBrokenManifest();
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    // `sync`'s shape, not `doctor`'s: a range that touched a member manifest, so the members pass
    // does not stand down for want of anything to discover and reaches the scan.
    const arrivals: MemberDiscovery = {
      changedDirs: ['packages/a'],
      kind: 'arrivals',
      namesBefore: ['@fixture/a'],
    };

    const report = await probeRefStructure(repo, { packages: CONFIGURED }, arrivals);

    expect(report.discovery_incomplete).toBe(OBSTACLE);
  });
});
