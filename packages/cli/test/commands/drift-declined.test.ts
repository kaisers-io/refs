import { addPackage, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import type { MemberDiscovery } from '../../src/commands/drift-discovery.ts';
import type { PackageEntry } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { probeRefStructure } from '../../src/commands/drift-probe.ts';

// What a recorded decision does to the probe, and — just as much — what it does not.
//
// A decline answers ONE question: "should this package the checkout declares be registered?" It
// is not a claim that the package is gone, so it must leave every finding about a configured
// entry exactly as it was, and it must not touch a report that could not finish looking.

const ALL: MemberDiscovery = { kind: 'all' };
const entry = (path: string): PackageEntry => ({ description: 'A fixture package.', path });

/** `packages/*` with `@fixture/a` registered, `@fixture/b` and `@fixture/c` unregistered. */
const monorepo = (): string => {
  const repo = freshRepo();
  writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
  addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
  addPackage(repo, 'packages/b', { name: '@fixture/b', version: '1.0.0' });
  addPackage(repo, 'packages/c', { name: '@fixture/c', version: '1.0.0' });
  return repo;
};

const CONFIGURED = { '@fixture/a': entry('packages/a') };

describe('a declined package', () => {
  it('stops being reported as unregistered', async () => {
    expect.hasAssertions();

    const report = await probeRefStructure(
      monorepo(),
      {
        declined_packages: [
          { name: '@fixture/b', path: 'packages/b' },
          { name: '@fixture/c', path: 'packages/c' },
        ],
        packages: CONFIGURED,
      },
      ALL,
    );

    expect(report.status).toBe('ok');
  });

  it('is still named in the report, so the decision stays visible', async () => {
    expect.hasAssertions();

    const report = await probeRefStructure(
      monorepo(),
      {
        declined_packages: [
          { name: '@fixture/b', path: 'packages/b' },
          { name: '@fixture/c', path: 'packages/c' },
        ],
        packages: CONFIGURED,
      },
      ALL,
    );

    // Quiet is not the same as hidden: anyone reading the JSON can see why the list is short.
    expect(report.declined).toStrictEqual([
      { name: '@fixture/b', path: 'packages/b' },
      { name: '@fixture/c', path: 'packages/c' },
    ]);
  });
});

describe('a declined package, beside the ones that are not', () => {
  it('leaves the other unregistered packages alone', async () => {
    expect.hasAssertions();

    const report = await probeRefStructure(
      monorepo(),
      { declined_packages: [{ name: '@fixture/b', path: 'packages/b' }], packages: CONFIGURED },
      ALL,
    );

    expect(report.packages).toStrictEqual([
      { name: '@fixture/c', path: 'packages/c', status: 'unregistered' },
    ]);
  });

  it('is reported again once it moves', async () => {
    expect.hasAssertions();

    // The decision was about a package at a path. The same name somewhere else is a different
    // question, and answering it from the old record would suppress whatever moved in.
    const report = await probeRefStructure(
      monorepo(),
      { declined_packages: [{ name: '@fixture/b', path: 'packages/moved' }], packages: CONFIGURED },
      ALL,
    );

    expect(report.packages).toContainEqual({
      name: '@fixture/b',
      path: 'packages/b',
      status: 'unregistered',
    });
  });
});

describe('what a decline must not silence', () => {
  it('leaves a configured package that is gone reported', async () => {
    expect.hasAssertions();

    // `missing` says the configuration and the checkout disagree. No decision about registering
    // something else makes that untrue — and declining by the same name must not reach it.
    const report = await probeRefStructure(
      monorepo(),
      {
        declined_packages: [{ name: '@fixture/gone', path: 'packages/gone' }],
        packages: { ...CONFIGURED, '@fixture/gone': entry('packages/gone') },
      },
      ALL,
    );

    expect(report.packages).toContainEqual({
      configured_path: 'packages/gone',
      name: '@fixture/gone',
      status: 'missing',
    });
  });

  it('keeps the other claimants of an ambiguous name', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    addPackage(repo, 'packages/one', { name: '@fixture/twin', version: '1.0.0' });
    addPackage(repo, 'packages/two', { name: '@fixture/twin', version: '1.0.0' });

    const report = await probeRefStructure(
      repo,
      {
        declined_packages: [{ name: '@fixture/twin', path: 'packages/one' }],
        packages: CONFIGURED,
      },
      ALL,
    );

    // Declining one path of a duplicated name leaves a real finding about the other. Collapsing
    // the whole name would hide a package nobody was asked about.
    expect(report.packages).toStrictEqual([
      { name: '@fixture/twin', path: 'packages/two', status: 'unregistered' },
    ]);
  });
});
