import {
  buildFinalPackages,
  buildProposalPackages,
  packagesNeedingDescription,
  registeredRootName,
  requireDescribablePackages,
} from '../../src/commands/add-packages.ts';
import { describe, expect, it } from 'vitest';
import type { WorkspacePackage } from '@kaisers-io/refs-core';

// Pure unit coverage for `add-packages.ts`'s description guard, split out of the integration
// suites (`add-description-required.test.ts`, `add-guards.test.ts`) because the single-package
// `npm:<pkg>` source case cannot be exercised end-to-end: like `add.test.ts`'s own npm: unit test
// notes, there is no way to make an `npm:<pkg>` source resolve to a local `file://` fixture.
//
// The fixtures below carry no descriptions because detection no longer produces any: a
// `WorkspacePackage` is identity only (see the type's comment in core). That is the point of the
// guard — every description in a finalized entry was written by someone who read the source.

const ONE_PACKAGE = 1;
// `buildProposalPackages`'s 2nd/3rd params are required (typed `string | undefined`, not
// optional) — named rather than a literal `undefined` at each call site below, mirroring
// `add-guards.test.ts`'s own `NO_CLONE_MODE_OVERRIDE` idiom.
const NO_NPM_DIRECTORY: string | undefined = undefined;
const NO_NPM_PKG_NAME: string | undefined = undefined;
// Most fixtures here declare no workspace root package at all.
const NO_ROOT: string | undefined = undefined;
const REF_DESCRIPTION = 'The Acme toolkit repository.';
const SOURCE = 'https://github.com/acme/toolkit.git';

describe('listing the packages the one-shot cannot describe', () => {
  it('names every detected package, sorted, when no root is registered', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { name: 'zeta', path: 'packages/zeta' },
      { name: 'alpha', path: 'packages/alpha' },
      { name: 'beta', path: 'packages/beta' },
    ];

    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(packagesNeedingDescription(packages, NO_ROOT)).toStrictEqual(['alpha', 'beta', 'zeta']);
  });

  it('names a single-package npm: source — no special case for "."', () => {
    expect.hasAssertions();
    // Mirrors `buildProposalPackages`'s npm: singleton branch: no workspace packages detected (a
    // genuinely single-package repo), so the only entry is synthesized from the resolved npm
    // package name/directory alone. It is not a DETECTED root, so it takes no exemption.
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, 'demo-package');

    expect(Object.keys(packages)).toHaveLength(ONE_PACKAGE);
    expect(packages['demo-package']?.path).toBe('.');
    expect(packagesNeedingDescription(packages, NO_ROOT)).toStrictEqual(['demo-package']);
  });

  it('lists nothing for an empty packages record (a plain, non-workspace git source)', () => {
    expect.hasAssertions();
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(packages).toStrictEqual({});
    expect(packagesNeedingDescription(packages, NO_ROOT)).toStrictEqual([]);
  });
});

describe('the description guard', () => {
  it('names every package and prints commands carrying the caller’s own source', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { name: 'zeta', path: 'packages/zeta' },
      { name: 'beta', path: 'packages/beta' },
    ];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() => requireDescribablePackages(packages, SOURCE)).toThrow(
      /their own source: beta, zeta.*two-phase flow/su,
    );
  });

  it('shell-quotes the source into the printed command rather than a <source> placeholder', () => {
    expect.hasAssertions();
    // `zRefKey`/source strings permit spaces and `$()`; a printed command is meant to be run as
    // printed, so the value has to survive a shell verbatim. See `shell-quote.ts`.
    const detected: WorkspacePackage[] = [{ name: 'a', path: 'packages/a' }];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() => requireDescribablePackages(packages, 'file:///tmp/a repo')).toThrow(
      /refs add 'file:\/\/\/tmp\/a repo' --dry-run --json > proposal\.json/u,
    );
  });

  it("tells the reader to fill in the ref's own description too", () => {
    expect.hasAssertions();
    // A dry-run proposal carries `description: ''`, which `zFinalProposal` rejects. A message that
    // only said "describe every package" would walk the reader into a second failure.
    const detected: WorkspacePackage[] = [{ name: 'a', path: 'packages/a' }];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() => requireDescribablePackages(packages, SOURCE)).toThrow(
      /fill in the ref's own description/iu,
    );
  });
});

describe('the shapes the guard lets through', () => {
  it('does not throw for an empty packages record', () => {
    expect.hasAssertions();
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() => requireDescribablePackages(packages, SOURCE)).not.toThrow();
  });

  it('does not throw when the only entry is the registered root', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [{ name: '@acme/toolkit', path: '.' }];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() =>
      requireDescribablePackages(packages, SOURCE, registeredRootName(detected, packages)),
    ).not.toThrow();
  });
});

describe('shaping the final packages record', () => {
  it("gives the root the ref's own description", () => {
    expect.hasAssertions();
    // The root is not a different thing from the repository — it IS the repository, at `.` — so
    // the text the caller just wrote about the repo describes it exactly, and the one-shot keeps
    // working for a single-package repo.
    const detected: WorkspacePackage[] = [{ name: '@acme/toolkit', path: '.' }];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    const finalPackages = buildFinalPackages(packages, {
      refDescription: REF_DESCRIPTION,
      rootPackageName: '@acme/toolkit',
    });

    expect(finalPackages?.['@acme/toolkit']).toStrictEqual({
      description: REF_DESCRIPTION,
      path: '.',
    });
  });

  it('returns undefined for an empty packages record', () => {
    expect.hasAssertions();
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(buildFinalPackages(packages, { refDescription: REF_DESCRIPTION })).toBeUndefined();
  });
});

describe('a root whose name a member already claims', () => {
  it('keeps the member and drops the root, rather than losing one silently', () => {
    expect.hasAssertions();
    // Real shape: `@remix-run/react-router` is a root name in a repository that also publishes
    // `react-router` from `packages/`. Detection dedupes by path, so both arrive here; the record
    // is keyed by name and would otherwise keep whichever came last.
    const detected: WorkspacePackage[] = [
      { name: '@acme/toolkit', path: '.' },
      { name: '@acme/toolkit', path: 'packages/toolkit' },
    ];

    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    // The member wins: it is the more specific thing, and it is what was registered before roots
    // were looked at at all — so a collision costs this repository nothing it used to have.
    expect(packages['@acme/toolkit']?.path).toBe('packages/toolkit');
    expect(Object.keys(packages)).toHaveLength(ONE_PACKAGE);
  });

  it('does not let the dropped root lend the member its exemption', () => {
    expect.hasAssertions();
    // Only the ROOT may take the ref's description, and the root here was dropped — so the
    // surviving entry is an ordinary child package and must still be rejected, rather than
    // quietly receiving text written about the repository.
    const detected: WorkspacePackage[] = [
      { name: '@acme/toolkit', path: '.' },
      { name: '@acme/toolkit', path: 'packages/toolkit' },
    ];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(
      packagesNeedingDescription(packages, registeredRootName(detected, packages)),
    ).toStrictEqual(['@acme/toolkit']);
  });

  it('still exempts a root that survives', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { name: '@acme/toolkit', path: '.' },
      { name: '@acme/a', path: 'packages/a' },
    ];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(
      packagesNeedingDescription(packages, registeredRootName(detected, packages)),
    ).toStrictEqual(['@acme/a']);
  });
});

describe('an npm fallback that lands on the root name', () => {
  it('does not exempt it when the packument points somewhere other than the root', () => {
    expect.hasAssertions();
    // No member selected, and the requested npm package happens to carry the root's own name — but
    // the packument places it in `packages/toolkit`. What survives under that name is an ordinary
    // package in a subdirectory, so it must be described from its own source like any other.
    const detected: WorkspacePackage[] = [{ name: '@acme/toolkit', path: '.' }];
    const packages = buildProposalPackages(detected, 'packages/toolkit', '@acme/toolkit');

    expect(packages['@acme/toolkit']?.path).toBe('packages/toolkit');
    expect(
      packagesNeedingDescription(packages, registeredRootName(detected, packages)),
    ).toStrictEqual(['@acme/toolkit']);
  });

  it('does exempt it when the packument points at the root itself', () => {
    expect.hasAssertions();
    // Same name, same directory, same manifest: this IS the root, however it was reached.
    const detected: WorkspacePackage[] = [{ name: '@acme/toolkit', path: '.' }];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, '@acme/toolkit');

    expect(
      packagesNeedingDescription(packages, registeredRootName(detected, packages)),
    ).toStrictEqual([]);
  });
});

describe('a workspace declaration that selects nothing', () => {
  it('keeps the npm package that was asked for, and the root alongside it', () => {
    expect.hasAssertions();
    // A repository declaring `packages/**`, which the pattern classifier does not support: the
    // root is found by looking, no member is selected. Seeding only the root would silently drop
    // the package named in `npm:<pkg>` — the entire reason that source was given.
    const detected: WorkspacePackage[] = [{ name: '@acme/toolkit', path: '.' }];

    const packages = buildProposalPackages(detected, 'packages/widget', '@acme/widget');

    expect(packages['@acme/widget']?.path).toBe('packages/widget');
    expect(packages['@acme/toolkit']?.path).toBe('.');
  });
});
