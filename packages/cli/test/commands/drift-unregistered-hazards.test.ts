import { addPackage, freshRepo, writeJson } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import type { MemberDiscovery } from '../../src/commands/drift-discovery.ts';
import type { PackageEntry } from '@kaisers-io/refs-core';
import { driftLines } from '../../src/commands/drift-report.ts';
import { join } from 'node:path';
import { probeRefStructure } from '../../src/commands/drift-probe.ts';
import { writeFileSync } from 'node:fs';

const FIXTURE_REF = 'github.com/acme/alpha';

// The ways member discovery can be wrong in a way that MATTERS: text it hands to a shell, a name
// it reports twice, and a scan too incomplete to support the claim it would make. Split from
// `drift-unregistered-members.test.ts` for the 300-line cap.

const entry = (path: string): PackageEntry => ({ description: 'A fixture package.', path });

// Every case here is `doctor`-shaped: these hazards are about what a finding CLAIMS, which does
// not depend on which range produced it.
const ALL: MemberDiscovery = { kind: 'all' };

const CONFIGURED = { '@fixture/a': entry('packages/a') };

describe('probeRefStructure: values that reach a shell', () => {
  it('quotes the name and path it puts into the repair command', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*'] });
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    // Both values come from the checkout. `zPackagePath` rejects only separators, dot segments,
    // percent escapes and colons, so `$()` is a legal path; a manifest `name` is checked only for
    // being non-empty. The line exists to be pasted into a shell.
    addPackage(repo, 'packages/$(id)', { name: '@evil/; rm -rf /tmp/x', version: '1.0.0' });

    const line = driftLines(await probeRefStructure(repo, CONFIGURED, ALL), FIXTURE_REF).join('\n');

    expect(line).toContain("--package='@evil/; rm -rf /tmp/x' --create --path='packages/$(id)'");
  });
});

describe('probeRefStructure: a member claiming the root name', () => {
  it('reports that name once, not once per discovery pass', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), {
      name: '@fixture/toolkit',
      workspaces: ['packages/*'],
    });
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    // Detection drops a root whose name a member claims, so `unregisteredRoot` resolves the name
    // to the MEMBER's path — the same entry member discovery sees. Excluding `.` from the members
    // does not separate them, because the root's finding is not at `.` here.
    addPackage(repo, 'packages/toolkit', { name: '@fixture/toolkit', version: '1.0.0' });

    const report = await probeRefStructure(repo, CONFIGURED, ALL);

    expect(report.packages).toStrictEqual([
      { name: '@fixture/toolkit', path: 'packages/toolkit', status: 'unregistered' },
    ]);
  });
});

describe('probeRefStructure: a scan that could not inspect everything', () => {
  it('says nothing about a package the repository explicitly excluded', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // A negation with a literal prefix is APPLIED, not reported unsupported, so `packages/excluded`
    // is subtracted from the selection and never becomes a member. The scan stays reliable and the
    // report stays `ok` — silence here is an answer, not a declined search.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/excluded'\n",
    );
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    addPackage(repo, 'packages/excluded', { name: '@fixture/excluded', version: '1.0.0' });

    const report = await probeRefStructure(repo, CONFIGURED, ALL);

    expect(report).toStrictEqual({ status: 'ok' });
  });
});

describe('probeRefStructure: a repository that declares a negation', () => {
  it('still reports a package the negation does not reach', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // Real monorepos declare negations: TanStack Query has two, both under `examples/vue/`.
    // Treating them like any other unsupported pattern silenced every finding about all hundred
    // of its packages — yet a dropped negation cannot HIDE anything, it only leaves in what the
    // repository meant to exclude. So it constrains the paths under it and nothing else.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - examples/*\n  - '!examples/legacy*'\n",
    );
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    addPackage(repo, 'packages/new', { name: '@fixture/new', version: '1.0.0' });
    addPackage(repo, 'examples/legacy-vue', { name: '@fixture/legacy', version: '1.0.0' });

    const report = await probeRefStructure(repo, CONFIGURED, ALL);

    // The package under the negation stays silent; the one outside it is reported.
    expect(report.packages).toStrictEqual([
      { name: '@fixture/new', path: 'packages/new', status: 'unregistered' },
    ]);
  });
});

describe('probeRefStructure: a negation that could exclude anything', () => {
  it('says nothing, because no path can be shown to be a member', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `!**/fixtures` has no literal prefix, so it cannot be scoped to a subtree the way
    // `!packages/fixtures` can. Dropping such a pattern from the prefix list without saying so
    // left it guarding nothing at all, and the excluded package was recommended for registration.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!**/fixtures'\n",
    );
    addPackage(repo, 'packages/a', { name: '@fixture/a', version: '1.0.0' });
    addPackage(repo, 'packages/fixtures', { name: '@fixture/fixtures', version: '1.0.0' });

    const report = await probeRefStructure(repo, CONFIGURED, ALL);

    expect(report).toStrictEqual({ status: 'ok' });
  });
});
