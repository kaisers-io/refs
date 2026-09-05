import { addPackage, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { driftLines, probeRefStructure } from '../../src/commands/drift-probe.ts';
import type { PackageEntry } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

// `drift-probe.ts` against real directories — the probe is pure filesystem reading, so a plain
// temp tree is the whole fixture; no git repo, no lock, no CLI. `sync-drift.test.ts` covers the
// same code through the real command, and `doctor-drift.test.ts` through `refs doctor`.

const ONE_ISSUE = 1;
const TWO_ISSUES = 2;

const entry = (path: string): PackageEntry => ({ description: 'A fixture package.', path });

// A ref entry whose `packages` key is simply absent — the ordinary shape for a repo `refs add`
// registered no packages for, and a different value from an empty record.
const NO_PACKAGES: Record<string, PackageEntry> | undefined = undefined;

/** A monorepo declaring `packages/*` with `@fixture/a` present at `packages/a`. */
const monorepo = (): string => {
  const repo = freshRepo();
  writeJson(join(repo, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
  addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
  return repo;
};

describe('probeRefStructure: nothing to report', () => {
  it('reports ok without a packages key when the ref configures no packages', async () => {
    expect.hasAssertions();

    await expect(probeRefStructure(monorepo(), NO_PACKAGES)).resolves.toStrictEqual({
      status: 'ok',
    });
  });

  it('reports ok when every configured path still declares its package', async () => {
    expect.hasAssertions();

    const report = await probeRefStructure(monorepo(), { '@fixture/a': entry('packages/a') });

    expect(report).toStrictEqual({ status: 'ok' });
  });
});

describe('probeRefStructure: removal vs relocation', () => {
  it('reports a package the upstream repo no longer declares as missing', async () => {
    expect.hasAssertions();

    const report = await probeRefStructure(monorepo(), { '@fixture/b': entry('packages/b') });

    expect(report.status).toBe('drift');
    expect(report.packages).toStrictEqual([
      { configured_path: 'packages/b', name: '@fixture/b', status: 'missing' },
    ]);
  });

  it('reports a package that moved as relocated, naming the new path', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    addPackage(repo, 'packages/moved', { name: '@fixture/b', version: '1.0.0' });

    const report = await probeRefStructure(repo, { '@fixture/b': entry('packages/b') });

    expect(report.status).toBe('drift');
    expect(report.packages).toStrictEqual([
      {
        configured_path: 'packages/b',
        name: '@fixture/b',
        path: 'packages/moved',
        status: 'relocated',
      },
    ]);
  });

  it('reports every candidate when the name now occurs at several paths', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    addPackage(repo, 'packages/one', { name: '@fixture/b', version: '1.0.0' });
    addPackage(repo, 'packages/two', { name: '@fixture/b', version: '1.0.0' });

    const report = await probeRefStructure(repo, { '@fixture/b': entry('packages/b') });

    expect(report.status).toBe('drift');
    expect(report.packages?.[0]).toStrictEqual({
      candidates: ['packages/one', 'packages/two'],
      configured_path: 'packages/b',
      name: '@fixture/b',
      status: 'ambiguous',
    });
  });
});

describe('probeRefStructure: a failure to look is never a drift claim', () => {
  it('reports an unreadable manifest as unknown, not as a missing package', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    addPackage(repo, 'packages/broken', { name: '@fixture/broken', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'packages/broken/package.json'), '{ not json');

    const report = await probeRefStructure(repo, {
      '@fixture/broken': entry('packages/broken'),
    });

    expect(report.status).toBe('unknown');
    expect(report.packages?.[0]?.status).toBe('unverifiable');
  });

  it('refuses to call a package missing in a repo that declares no workspaces', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { name: 'single-package-repo' });

    const report = await probeRefStructure(repo, { '@fixture/b': entry('packages/b') });

    expect(report.status).toBe('unknown');
    expect(report.packages?.[0]?.reason).toContain('declares no workspaces');
  });

  it('withholds every verdict when an unreadable manifest makes the scan incomplete', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    addPackage(repo, 'packages/moved', { name: '@fixture/b', version: '1.0.0' });
    // Inside the `packages/*` glob, so the scan itself is incomplete: the relocation below is a
    // real sighting, but nothing rules out a second copy behind the manifest that would not parse.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'packages/a/package.json'), '{ not json');

    const report = await probeRefStructure(repo, { '@fixture/b': entry('packages/b') });

    expect(report.status).toBe('unknown');
    expect(report.packages?.[0]?.reason).toContain('incomplete');
  });
});

describe('probeRefStructure: mixed findings', () => {
  it('keeps the overall status at drift when one package is unverifiable and another moved', async () => {
    expect.hasAssertions();
    const repo = monorepo();
    addPackage(repo, 'packages/moved', { name: '@fixture/b', version: '1.0.0' });
    // Outside the workspace globs, so it never enters the scan and cannot make it unreliable —
    // only this one package's own verdict is withheld.
    addPackage(repo, 'vendor/broken', { name: '@fixture/vendored', version: '1.0.0' });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(repo, 'vendor/broken/package.json'), '{ not json');

    const report = await probeRefStructure(repo, {
      '@fixture/b': entry('packages/b'),
      '@fixture/vendored': entry('vendor/broken'),
    });

    expect(report.status).toBe('drift');
    expect(report.packages).toHaveLength(TWO_ISSUES);
  });
});

describe('drift lines: silence and ref-level failures', () => {
  it('says nothing at all for a clean ref', () => {
    expect.hasAssertions();

    expect(driftLines({ status: 'ok' })).toStrictEqual([]);
  });

  it('reports a whole-probe failure as one ref-level line', () => {
    expect.hasAssertions();

    expect(driftLines({ reason: 'EACCES', status: 'unknown' })).toStrictEqual([
      'could not be checked — EACCES',
    ]);
  });
});

describe('drift lines: removal reads differently from relocation', () => {
  it('prescribes removal for a missing package and a path fix for a relocated one', () => {
    expect.hasAssertions();

    const lines = driftLines({
      packages: [
        { configured_path: 'packages/b', name: '@fixture/b', status: 'missing' },
        {
          configured_path: 'packages/c',
          name: '@fixture/c',
          path: 'packages/moved',
          status: 'relocated',
        },
      ],
      status: 'drift',
    });

    expect(lines[0]).toContain('remove the entry');
    expect(lines[1]).toContain('moved to packages/moved');
  });

  it('falls back to a placeholder rather than printing undefined', () => {
    expect.hasAssertions();

    const lines = driftLines({
      packages: [
        { configured_path: 'a', name: 'no-path', status: 'relocated' },
        { configured_path: 'b', name: 'no-candidates', status: 'ambiguous' },
        { configured_path: 'c', name: 'no-reason', status: 'unverifiable' },
      ],
      status: 'drift',
    });

    expect(lines).toHaveLength(ONE_ISSUE + TWO_ISSUES);
    expect(lines.join(' ')).not.toContain('undefined');
  });
});

describe('probeRefStructure: a root that shares a package name', () => {
  it('does not report a deleted member as having moved to the repository root', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // The root declares the same name as a member that upstream has since deleted. The root is
    // then the only thing carrying that name — and calling it a relocation would send a caller to
    // the repository root for a package that was removed, describing a move that never happened.
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      workspaces: ['packages/*'],
    });
    addPackage(repo, 'packages/other', { name: '@fixture/other', version: '1.0.0' });

    const report = await probeRefStructure(repo, {
      '@fixture/toolkit': entry('packages/toolkit'),
    });

    expect(report.packages?.[0]).toStrictEqual({
      configured_path: 'packages/toolkit',
      name: '@fixture/toolkit',
      status: 'missing',
    });
  });

  it('still reports a real move between two subdirectories', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      workspaces: ['packages/*'],
    });
    // The member moved rather than vanished, and the same-named root must not obscure that.
    addPackage(repo, 'packages/new-toolkit', { name: '@fixture/toolkit', version: '1.0.0' });

    const report = await probeRefStructure(repo, {
      '@fixture/toolkit': entry('packages/toolkit'),
    });

    expect(report.packages?.[0]).toStrictEqual({
      configured_path: 'packages/toolkit',
      name: '@fixture/toolkit',
      path: 'packages/new-toolkit',
      status: 'relocated',
    });
  });
});
