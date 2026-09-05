import { addPackage, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import type { MemberDiscovery } from '../../src/commands/drift-discovery.ts';
import type { PackageEntry } from '@kaisers-io/refs-core';
import { driftLines } from '../../src/commands/drift-report.ts';
import { join } from 'node:path';
import { probeRefStructure } from '../../src/commands/drift-probe.ts';
import { writeFileSync } from 'node:fs';

// The migration half of #88: a ref added before roots were registered keeps the package map it was
// given, and no command adds one entry to an existing ref. The drift probe already holds both the
// checkout and the configuration on every sync, so this is where that gap surfaces. Split from
// `drift-probe.test.ts` for the 300-line cap.
//
// Member discovery stays off throughout: the root is reported on its own evidence (a manifest
// read), independently of whether this fetch added anything.
const ARRIVALS_NONE: MemberDiscovery = { kind: 'arrivals', paths: [] };

/** `probeRefStructure` with member discovery off — the shape `sync` uses on a ref whose fetch
 * added nothing, and the only one these cases are about. */
const probe = (
  checkoutDir: string,
  packages: Parameters<typeof probeRefStructure>[1],
): ReturnType<typeof probeRefStructure> => probeRefStructure(checkoutDir, packages, ARRIVALS_NONE);

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

    const report = await probe(repo, { '@fixture/a': entry('packages/a') });

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

    const report = await probe(repo, {
      '@fixture/a': entry('packages/a'),
      '@fixture/toolkit': entry('.'),
    });

    expect(report).toStrictEqual({ status: 'ok' });
  });
});

describe('probeRefStructure: a root there is nothing to report about', () => {
  it('says nothing about a root that names nothing', async () => {
    expect.hasAssertions();
    // The ordinary shape: most workspace roots are private and unnamed. Reporting them would put a
    // finding on every sync of every repository.
    const report = await probe(monorepo(), { '@fixture/a': entry('packages/a') });

    expect(report).toStrictEqual({ status: 'ok' });
  });
});

describe('drift lines: an unregistered root', () => {
  it('names the command that registers it', () => {
    expect.hasAssertions();

    const [line] = driftLines({
      packages: [{ name: '@acme/toolkit', path: '.', status: 'unregistered' }],
      status: 'drift',
    });

    // `refs add` refuses a tracked ref and an ordinary `refs edit --package` needs an entry to
    // edit — which is what `--create` was added for. Before it, the only instruction this line
    // could give was a `config.toml` fragment to type in by hand.
    expect(line).toContain('not registered');
    expect(line).toContain("refs edit <ref> --package '@acme/toolkit' --create --path '.'");
  });
});

describe('probeRefStructure: a root whose name a member also claims', () => {
  it('prescribes the member path, which is where registration would put it', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      private: true,
      workspaces: ['packages/*'],
    });
    // A member declares the same name. Detection drops the root and selects the member, so
    // prescribing `.` from the raw root read would tell someone to register the repository root
    // where `refs add` would have registered `packages/toolkit`.
    addPackage(repo, 'packages/toolkit', { name: '@fixture/toolkit', version: '1.0.0' });

    const report = await probe(repo, { '@fixture/a': entry('packages/a') });

    expect(report.packages).toContainEqual({
      name: '@fixture/toolkit',
      path: 'packages/toolkit',
      status: 'unregistered',
    });
  });

  it('carries that path into the line it prints', () => {
    expect.hasAssertions();

    const [line] = driftLines({
      packages: [{ name: '@acme/toolkit', path: 'packages/toolkit', status: 'unregistered' }],
      status: 'drift',
    });

    expect(line).toContain("--create --path 'packages/toolkit'");
  });
});

describe('probeRefStructure: an unregistered root the scan cannot settle', () => {
  it('says nothing while an unreadable manifest could still change the answer', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      workspaces: ['packages/*'],
    });
    // A member sharing this name could be sitting behind that unreadable manifest, and it would
    // win once readable. Prescribing `.` now would be advice a later sync contradicts.
    addPackage(repo, 'packages/broken', { name: '@fixture/broken', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'packages/broken/package.json'), '{ not json');

    const report = await probe(repo, { '@fixture/a': entry('packages/a') });

    // Silent entirely: the configured package verified, and the root question could not be
    // settled, so there is nothing this run may claim.
    expect(report).toStrictEqual({ status: 'ok' });
  });
});

describe('probeRefStructure: a root name several paths declare', () => {
  it('names the candidates rather than picking one', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      workspaces: ['packages/*'],
    });
    // Two members claim it. Which to register is a decision, and `refs add` itself keeps the last
    // — so picking the first here would prescribe something registration does not do.
    addPackage(repo, 'packages/one', { name: '@fixture/toolkit', version: '1.0.0' });
    addPackage(repo, 'packages/two', { name: '@fixture/toolkit', version: '1.0.0' });

    const report = await probe(repo, { '@fixture/a': entry('packages/a') });

    expect(report.packages).toContainEqual({
      candidates: ['packages/one', 'packages/two'],
      name: '@fixture/toolkit',
      status: 'unregistered',
    });
  });

  it('names them in the line it prints, instead of a path', () => {
    expect.hasAssertions();

    const [line] = driftLines({
      packages: [
        {
          candidates: ['packages/one', 'packages/two'],
          name: '@acme/toolkit',
          status: 'unregistered',
        },
      ],
      status: 'drift',
    });

    expect(line).toContain('packages/one, packages/two');
    // No `--create` command either: which path to register is a decision, not a lookup, so the
    // line must not hand over one that looks ready to run.
    expect(line).not.toContain('--create');
  });
});
