import { addPackage, freshRepo, writeJson } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { detectWorkspacePackages } from '../src/workspaces.ts';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

// Tables read off the real resolvers — npm's `@npmcli/map-workspaces` and pnpm itself — for the
// declaration shapes where the two are easy to get wrong: re-inclusion, trailing slashes, repeated
// exclamation marks, leading `./`. These are the regression guard for delegating matching, so an
// expectation here should only ever change alongside a measurement against the resolver.

describe("npm's re-inclusion rule", () => {
  // Every expectation here was read off `@npmcli/map-workspaces`, the resolver npm itself uses.
  // The rule is about the PATTERN STRING, not the directories a pattern selects: a later literal
  // `packages/cli` cancels `!packages/cli`, while a later `packages/*` does not, even though it
  // selects that same directory.
  const table: [string[], string[]][] = [
    [['packages/cli', '!packages/cli', 'packages/*'], ['@mono/core']],
    [['packages/*', '!packages/cli', 'packages/*'], ['@mono/core']],
    [['!packages/cli', 'packages/*'], ['@mono/core']],
    [
      ['packages/cli', 'packages/*', '!packages/cli', 'packages/cli'],
      ['@mono/cli', '@mono/core'],
    ],
  ];

  it.each(table)('resolves %j the way npm does', async (workspaces, expected) => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces });
    addPackage(repo, 'packages/cli', { name: '@mono/cli', version: '1.0.0' });
    addPackage(repo, 'packages/core', { name: '@mono/core', version: '1.0.0' });

    const scan = await detectWorkspacePackages(repo);

    expect(scan.map((pkg) => pkg.name).toSorted()).toStrictEqual(expected);
  });
});

describe('a trailing slash on the negation itself', () => {
  // minimatch tolerates a trailing slash on the PATH and requires one on the pattern — measured:
  // `minimatch('packages/cli/', 'packages/cli')` is true, `minimatch('packages/cli',
  // 'packages/cli/')` is false. So which side carries the slash decides whether a later pattern
  // cancels the exclusion, and every expectation here was read off npm's own resolver.
  const table: [string[], string[]][] = [
    [
      ['packages/*', '!packages/cli', 'packages/cli/'],
      ['@mono/cli', '@mono/core'],
    ],
    [['packages/*', '!packages/cli/', 'packages/cli'], ['@mono/core']],
    [
      ['packages/*', '!packages/cli/', 'packages/cli/'],
      ['@mono/cli', '@mono/core'],
    ],
  ];

  it.each(table)('resolves %j the way npm does', async (workspaces, expected) => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces });
    addPackage(repo, 'packages/cli', { name: '@mono/cli', version: '1.0.0' });
    addPackage(repo, 'packages/core', { name: '@mono/core', version: '1.0.0' });

    const scan = await detectWorkspacePackages(repo);

    expect(scan.map((pkg) => pkg.name).toSorted()).toStrictEqual(expected);
  });
});

describe("pnpm's rule, which is not npm's", () => {
  it('keeps an exclusion a later identical pattern would cancel under npm', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // Verified against pnpm itself: it reports only `@mono/core` for this declaration, where npm
    // reports both. pnpm hands its list to tinyglobby, where a negation is an ignore and nothing
    // takes it back; npm walks the list and lets a later pattern cancel an earlier negation.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/cli'\n  - packages/cli\n",
    );
    addPackage(repo, 'packages/cli', { name: '@mono/cli', version: '1.0.0' });
    addPackage(repo, 'packages/core', { name: '@mono/core', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([
      { name: '@mono/core', path: 'packages/core' },
    ]);
  });

  it('applies a wildcard exclusion written with a repeated separator', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `!packages//*` names what `!packages/*` names. A repeated separator must not decide whether
    // the exclusion has any effect.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages//*'\n",
    );
    addPackage(repo, 'packages/cli', { name: '@mono/cli', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
  });
});

describe('the marks and prefixes both resolvers strip', () => {
  // Read off npm's resolver and confirmed against pnpm, which agrees on all four.
  const table: [string[], string[]][] = [
    [
      ['packages/*', '!!packages/cli'],
      ['@mono/cli', '@mono/core'],
    ],
    [['packages/*', '!!!packages/cli'], ['@mono/core']],
    [['packages/*', '!./packages/cli'], ['@mono/core']],
    [['./packages/*'], ['@mono/cli', '@mono/core']],
  ];

  it.each(table)('resolves %j the way npm does', async (workspaces, expected) => {
    expect.hasAssertions();
    const repo = freshRepo();
    writeJson(join(repo, 'package.json'), { workspaces });
    addPackage(repo, 'packages/cli', { name: '@mono/cli', version: '1.0.0' });
    addPackage(repo, 'packages/core', { name: '@mono/core', version: '1.0.0' });

    const scan = await detectWorkspacePackages(repo);

    expect(scan.map((pkg) => pkg.name).toSorted()).toStrictEqual(expected);
  });
});

describe("npm's pattern-filtering step, which pnpm has no equivalent of", () => {
  it('drops a positive pattern a surviving negation names, not just the directories', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // `!packages/?` names the pattern STRING `packages/*` — `?` matches its literal `*` — while
    // naming no directory the glob would produce. npm therefore drops `packages/*` outright and
    // returns nothing. Testing only expanded directories returns everything, which is how this
    // step was once mistaken for an optimization and removed.
    writeJson(join(repo, 'package.json'), { workspaces: ['packages/*', '!packages/?'] });
    addPackage(repo, 'packages/cli', { name: '@mono/cli', version: '1.0.0' });
    addPackage(repo, 'packages/core', { name: '@mono/core', version: '1.0.0' });

    await expect(detectWorkspacePackages(repo)).resolves.toStrictEqual([]);
  });

  it('does not apply to a pnpm declaration, which keeps both packages', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    // Asked directly, pnpm returns both for this declaration — its ignores apply to results, not
    // to the pattern list. Applying npm's step here would have silently emptied the scan.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      join(repo, 'pnpm-workspace.yaml'),
      "packages:\n  - packages/*\n  - '!packages/?'\n",
    );
    addPackage(repo, 'packages/cli', { name: '@mono/cli', version: '1.0.0' });
    addPackage(repo, 'packages/core', { name: '@mono/core', version: '1.0.0' });

    const scan = await detectWorkspacePackages(repo);

    expect(scan.map((pkg) => pkg.name).toSorted()).toStrictEqual(['@mono/cli', '@mono/core']);
  });
});
