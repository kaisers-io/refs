import {
  buildFinalPackages,
  buildProposalPackages,
  packagesMissingDescription,
  requireAllDescribed,
} from '../../src/commands/add-packages.ts';
import { describe, expect, it } from 'vitest';
import type { WorkspacePackage } from '@kaisers-io/refs-core';

// Pure unit coverage for `add-packages.ts`'s description-requirement guard, split out of the
// integration suites (`add-description-required.test.ts`, `add-guards.test.ts`) because the
// single-package `npm:<pkg>` source case cannot be exercised end-to-end: like `add.test.ts`'s own
// npm: unit test notes, there is no way to make an `npm:<pkg>` source resolve to a local `file://`
// fixture, and `buildProposalPackages`'s npm branch (see that file) never carries a description at
// all — it is built purely from the resolved `{name, directory}`, never a cloned manifest.

const ONE_PACKAGE = 1;
// `buildProposalPackages`'s 2nd/3rd params are required (typed `string | undefined`, not
// optional) — named rather than a literal `undefined` at each call site below, mirroring
// `add-guards.test.ts`'s own `NO_CLONE_MODE_OVERRIDE` idiom.
const NO_NPM_DIRECTORY: string | undefined = undefined;
const NO_NPM_PKG_NAME: string | undefined = undefined;
// Most fixtures here declare no workspace root package at all.
const NO_ROOT: string | undefined = undefined;
const REF_DESCRIPTION = 'The Acme toolkit repository.';

describe('listing packages missing a description', () => {
  it('lists nothing when every package already has a description', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { description: 'A', name: 'a', path: 'packages/a' },
      { description: 'B', name: 'b', path: 'packages/b' },
    ];

    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(packagesMissingDescription(packages, NO_ROOT)).toStrictEqual([]);
  });

  it('names only the packages missing a description in a mixed set, sorted', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { description: undefined, name: 'zeta', path: 'packages/zeta' },
      { description: 'Alpha package', name: 'alpha', path: 'packages/alpha' },
      { description: undefined, name: 'beta', path: 'packages/beta' },
    ];

    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(packagesMissingDescription(packages, NO_ROOT)).toStrictEqual(['beta', 'zeta']);
  });

  it('lists a single-package npm: source with no manifest description — no special case for "."', () => {
    expect.hasAssertions();
    // Mirrors `buildProposalPackages`'s npm: singleton branch: no workspace packages detected (a
    // genuinely single-package repo), so the only entry is synthesized from the resolved npm
    // package name/directory alone — it never carries a description.
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, 'demo-package');

    expect(Object.keys(packages)).toHaveLength(ONE_PACKAGE);
    expect(packages['demo-package']?.path).toBe('.');
    expect(packagesMissingDescription(packages, NO_ROOT)).toStrictEqual(['demo-package']);
  });

  it('lists nothing for an empty packages record (a plain, non-workspace git source)', () => {
    expect.hasAssertions();
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(packages).toStrictEqual({});
    expect(packagesMissingDescription(packages, NO_ROOT)).toStrictEqual([]);
  });
});

describe('an empty-string manifest description counts as missing', () => {
  it("treats '' as missing, mirroring zPackageEntry's min(1) rule", () => {
    expect.hasAssertions();
    // `extractPackageDescription` (core) returns ANY string from the manifest, including `""` —
    // exactly what `npm init -y` scaffolds. `zPackageEntry.description` requires `min(1)`, so an
    // empty string must count as missing here too, or the one-shot would bypass the guard and die
    // later in finalize with the degraded generic schema error this guard exists to prevent.
    const detected: WorkspacePackage[] = [
      { description: '', name: 'scaffolded', path: 'packages/scaffolded' },
      { description: 'Real description', name: 'described', path: 'packages/described' },
    ];

    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(packagesMissingDescription(packages, NO_ROOT)).toStrictEqual(['scaffolded']);
    expect(() => requireAllDescribed(packages)).toThrow(
      /packages without a detected description: scaffolded/u,
    );
  });
});

describe('the description-required guard', () => {
  it('does not throw once every package has a description', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [{ description: 'A', name: 'a', path: 'packages/a' }];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() => requireAllDescribed(packages)).not.toThrow();
  });

  it('names every package still missing a description and points at the two-phase flow', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { description: undefined, name: 'zeta', path: 'packages/zeta' },
      { description: undefined, name: 'beta', path: 'packages/beta' },
    ];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() => requireAllDescribed(packages)).toThrow(
      /packages without a detected description: beta, zeta.*run the two-phase flow instead/su,
    );
  });

  it('does not throw for an empty packages record', () => {
    expect.hasAssertions();
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(() => requireAllDescribed(packages)).not.toThrow();
  });
});

describe('shaping the final packages record', () => {
  it('carries each package’s own description through once all are present', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { description: 'A package', name: 'a', path: 'packages/a' },
      { description: 'B package', name: 'b', path: 'packages/b' },
    ];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    const finalPackages = buildFinalPackages(packages, { refDescription: REF_DESCRIPTION });

    expect(finalPackages?.['a']).toStrictEqual({ description: 'A package', path: 'packages/a' });
    expect(finalPackages?.['b']).toStrictEqual({ description: 'B package', path: 'packages/b' });
  });

  it('returns undefined for an empty packages record', () => {
    expect.hasAssertions();
    const packages = buildProposalPackages([], NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    expect(buildFinalPackages(packages, { refDescription: REF_DESCRIPTION })).toBeUndefined();
  });
});

describe('the workspace root entry', () => {
  it("gives the root the ref's own description when its manifest has none", () => {
    expect.hasAssertions();
    // A workspace root is private and almost never carries a `description`. It is not a different
    // thing from the repository, though — it IS the repository, at `.` — so the text the caller
    // just wrote about the repo describes it exactly, and the one-shot flow keeps working.
    const detected: WorkspacePackage[] = [
      { description: undefined, name: '@acme/toolkit', path: '.' },
      { description: 'A package', name: 'a', path: 'packages/a' },
    ];
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

  it('leaves a root that describes itself alone', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { description: 'The toolkit monorepo', name: '@acme/toolkit', path: '.' },
    ];
    const packages = buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME);

    const finalPackages = buildFinalPackages(packages, {
      refDescription: REF_DESCRIPTION,
      rootPackageName: '@acme/toolkit',
    });

    expect(finalPackages?.['@acme/toolkit']).toStrictEqual({
      description: 'The toolkit monorepo',
      path: '.',
    });
  });
});

describe('one name claimed at two paths', () => {
  it('refuses rather than silently keeping one of them', () => {
    expect.hasAssertions();
    // Not hypothetical since the root joined detection: `@remix-run/react-router` is a real root
    // name in a repository that also publishes `react-router` from `packages/`. A root sharing a
    // member's name would otherwise vanish from the record, which is keyed by name.
    const detected: WorkspacePackage[] = [
      { description: 'The monorepo', name: '@acme/toolkit', path: '.' },
      { description: 'A package', name: '@acme/toolkit', path: 'packages/toolkit' },
    ];

    expect(() => buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME)).toThrow(
      'more than one path',
    );
  });

  it('names every collision and the paths claiming it', () => {
    expect.hasAssertions();
    const detected: WorkspacePackage[] = [
      { description: 'Root', name: 'dup', path: '.' },
      { description: 'Member', name: 'dup', path: 'packages/dup' },
    ];

    // Naming both paths is the whole value: refs cannot tell which directory was meant, so the
    // reader has to, and they need to see the candidates to do it.
    expect(() => buildProposalPackages(detected, NO_NPM_DIRECTORY, NO_NPM_PKG_NAME)).toThrow(
      'dup (., packages/dup)',
    );
  });
});
