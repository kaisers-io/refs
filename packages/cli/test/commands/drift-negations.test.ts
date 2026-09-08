import { addPackage, freshRepo } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import type { MemberDiscovery } from '../../src/commands/drift-discovery.ts';
import type { PackageEntry } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { probeRefStructure } from '../../src/commands/drift-probe.ts';
import { writeFileSync } from 'node:fs';

// What a negated workspace pattern does and does not permit.
//
// A dropped negation leaves directories in the scan that the repository declared out of scope, so
// the scan holds too much and hides nothing. Absence survives that; every claim that a particular
// path IS a member does not. Split from `drift-probe.test.ts` for the 300-line cap.

const ARRIVALS_NONE: MemberDiscovery = { changedDirs: [], kind: 'arrivals', namesBefore: [] };

const entry = (path: string): PackageEntry => ({ description: 'A fixture package.', path });

const probe = (
  checkoutDir: string,
  packages: Parameters<typeof probeRefStructure>[1],
): ReturnType<typeof probeRefStructure> => probeRefStructure(checkoutDir, packages, ARRIVALS_NONE);

describe('probeRefStructure: a repository that declares a negation', () => {
  it('still reports a configured package that is gone', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // A dropped negation leaves directories IN the scan, so the scan is a superset of real
    // membership — absence is better evidence under it, not worse. Refusing to answer here left
    // every package of a real monorepo `unverifiable` and disabled drift detection outright.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/legacy*'\n",
    );
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });

    const report = await probe(repo, { '@fixture/gone': entry('packages/gone') });

    expect(report.packages).toStrictEqual([
      { configured_path: 'packages/gone', name: '@fixture/gone', status: 'missing' },
    ]);
  });
});

describe('probeRefStructure: a name that survives only in an excluded directory', () => {
  it('does not name it as the new location', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // A negation leaves the excluded directory in the scan, which is fine for absence — the scan
    // holds too much, so failing to find something is still failing. It is not fine for
    // `relocated`, which says the package now LIVES there: a fixtures tree upstream deliberately
    // keeps out of its workspace is not somewhere to send a caller.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/fixtures'\n",
    );
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    addPackage(repo, 'packages/fixtures', { name: '@fixture/b', version: '1.0.0' });

    const report = await probe(repo, { '@fixture/b': entry('packages/b') });

    expect(report.packages).toStrictEqual([
      { configured_path: 'packages/b', name: '@fixture/b', status: 'missing' },
    ]);
  });
});
