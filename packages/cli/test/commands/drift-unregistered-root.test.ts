import { addPackage, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { driftLines, probeRefStructure } from '../../src/commands/drift-probe.ts';
import type { PackageEntry } from '@kaisers-io/refs-core';
import { join } from 'node:path';

// The migration half of #88: a ref added before roots were registered keeps the package map it was
// given, and no command adds one entry to an existing ref. The drift probe already holds both the
// checkout and the configuration on every sync, so this is where that gap surfaces. Split from
// `drift-probe.test.ts` for the 300-line cap.

const entry = (path: string): PackageEntry => ({ description: 'A fixture package.', path });

/** A monorepo declaring `packages/*`, with `@fixture/a` present and an UNNAMED root. */
const monorepo = (): string => {
  const repo = freshRepo();
  writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
  addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
  return repo;
};

describe('probeRefStructure: a root the configuration never registered', () => {
  it('reports it, so a ref added before roots were registered can catch up', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    // The migration half of #88. `refs add` registers a named root now, but a ref added earlier
    // keeps the map it was given — and no command adds one entry to an existing ref. The drift
    // probe already holds both sides on every sync, so this is where the gap surfaces.
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      private: true,
      workspaces: ['packages/*'],
    });

    const report = await probeRefStructure(repo, { '@fixture/a': entry('packages/a') });

    expect(report.status).toBe('drift');
    expect(report.packages).toContainEqual({
      name: '@fixture/toolkit',
      path: '.',
      status: 'unregistered',
    });
  });

  it('says nothing once that root is registered', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      private: true,
      workspaces: ['packages/*'],
    });

    const report = await probeRefStructure(repo, {
      '@fixture/a': entry('packages/a'),
      '@fixture/toolkit': entry('.'),
    });

    expect(report).toStrictEqual({ status: 'ok' });
  });

  it('says nothing about a root that names nothing', async () => {
    expect.hasAssertions();
    // The ordinary shape: most workspace roots are private and unnamed. Reporting them would put a
    // finding on every sync of every repository.
    const report = await probeRefStructure(monorepo(), { '@fixture/a': entry('packages/a') });

    expect(report).toStrictEqual({ status: 'ok' });
  });
});

describe('drift lines: an unregistered root', () => {
  it('says how to register it, since no command does', () => {
    expect.hasAssertions();

    const [line] = driftLines({
      packages: [{ name: '@acme/toolkit', path: '.', status: 'unregistered' }],
      status: 'drift',
    });

    // `refs add` refuses a tracked ref and `refs edit --package` needs an entry to edit, so the
    // instruction has to be the entry itself.
    expect(line).toContain('not registered');
    expect(line).toContain('path = "."');
  });
});
