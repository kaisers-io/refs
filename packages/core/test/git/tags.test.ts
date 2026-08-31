import { describe, expect, it } from 'vitest';
import { detectTagFormat, renderTag, resolveTag } from '../../src/git/tags.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';

const runner = new SpawnRunner();

// Real git work (fixture repo creation + tag resolution) under parallel suite load can exceed
// vitest's 5s default — mirrors `git/repo.test.ts`'s own `SUITE_OPTS` idiom.
const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };

const assertFormatDetected = (tags: readonly string[], expected: string): void => {
  const result = detectTagFormat(tags);
  expect(result).toBe(expected);
};

const assertFormatNotDetected = (tags: readonly string[]): void => {
  const result = detectTagFormat(tags);
  expect(result).toBeNull();
};

type TagResolutionFixture = {
  dir: string;
  format: string;
  version: string;
};

const resolveTagForTest = async (fixture: TagResolutionFixture): Promise<unknown> => {
  try {
    return await resolveTag(runner, fixture.dir, fixture.format as never, fixture.version);
  } catch (error) {
    return error;
  }
};

describe('format detection: basic', () => {
  it('detects v{version} format', () => {
    expect.hasAssertions();
    assertFormatDetected(['v15.3.0', 'v15.2.9'], 'v{version}');
  });

  it('detects release/v{version} format', () => {
    expect.hasAssertions();
    assertFormatDetected(['release/v4.1.0'], 'release/v{version}');
  });

  it('detects {version} format (no prefix)', () => {
    expect.hasAssertions();
    assertFormatDetected(['4.1.0'], '{version}');
  });

  it('detects next@{version} format', () => {
    expect.hasAssertions();
    assertFormatDetected(['next@15.0.0', 'next@14.9.0'], 'next@{version}');
  });

  it('ignores non-semver tags', () => {
    expect.hasAssertions();
    assertFormatDetected(['v2.0.0', 'v1.0.0', 'docs-1'], 'v{version}');
  });

  it('returns undefined for tags without semver', () => {
    expect.hasAssertions();
    assertFormatNotDetected(['foo', 'bar']);
  });

  it('returns undefined for empty array', () => {
    expect.hasAssertions();
    assertFormatNotDetected([]);
  });
});

describe('format detection: edge cases', () => {
  it('resolves ties by most recent tag (first in input)', () => {
    expect.hasAssertions();
    // Pkg@2.0.0 is first (most recent), v1.0.0 is second
    // Both appear once, so pkg@2.0.0 wins
    assertFormatDetected(['pkg@2.0.0', 'v1.0.0'], 'pkg@{version}');
  });

  it('handles prerelease versions', () => {
    expect.hasAssertions();
    // Both tags derive to the same format and contribute to the count.
    assertFormatDetected(['v1.0.0-alpha', 'v1.0.0-beta.1'], 'v{version}');
  });

  it('handles dotted prerelease identifiers (e.g. canary builds)', () => {
    expect.hasAssertions();
    assertFormatDetected(['v15.0.0-canary.28', 'v15.0.0-canary.27'], 'v{version}');
  });

  it('handles a single dotted prerelease identifier', () => {
    expect.hasAssertions();
    assertFormatDetected(['v1.0.0-alpha.1'], 'v{version}');
  });

  it('handles build metadata', () => {
    expect.hasAssertions();
    assertFormatDetected(['v1.0.0+build.1', 'v1.0.0+build.2'], 'v{version}');
  });

  it('handles prerelease and build metadata together', () => {
    expect.hasAssertions();
    assertFormatDetected(['v1.0.0-alpha+build.1', 'v1.0.0-beta.2+build.3'], 'v{version}');
  });

  it('ignores tags with multiple semver substrings', () => {
    expect.hasAssertions();
    // Compare-1.2.3-to-2.0.0 has two semver matches, so it's ignored.
    // V1.0.0 is the only valid one, so it wins.
    assertFormatDetected(['compare-1.2.3-to-2.0.0', 'v1.0.0'], 'v{version}');
  });

  it('treats a leftover numeric suffix as part of the format when it is not a full semver', () => {
    expect.hasAssertions();
    // The first match consumes 1.2.3, leaving .4 — which does not contain a
    // Second full semver, so this is a valid (if unusual) derived format.
    assertFormatDetected(['1.2.3.4'], '{version}.4');
  });
});

describe('tag rendering', () => {
  it('replaces {version} with the provided version', () => {
    expect.hasAssertions();
    const result = renderTag('v{version}', '15.3.0');
    expect(result).toBe('v15.3.0');
  });

  it('handles release/v{version} format', () => {
    expect.hasAssertions();
    const result = renderTag('release/v{version}', '4.1.0');
    expect(result).toBe('release/v4.1.0');
  });

  it('handles {version} format with no prefix', () => {
    expect.hasAssertions();
    const result = renderTag('{version}', '1.0.0');
    expect(result).toBe('1.0.0');
  });

  it('handles pkg@{version} format', () => {
    expect.hasAssertions();
    const result = renderTag('pkg@{version}', '2.0.0');
    expect(result).toBe('pkg@2.0.0');
  });

  it('preserves prerelease versions', () => {
    expect.hasAssertions();
    const result = renderTag('v{version}', '1.0.0-alpha');
    expect(result).toBe('v1.0.0-alpha');
  });

  it('replaces multiple {version} placeholders', () => {
    expect.hasAssertions();
    const result = renderTag('release/{version}/{version}', '1.0.0');
    expect(result).toBe('release/1.0.0/1.0.0');
  });

  it('preserves dollar signs in version strings', () => {
    expect.hasAssertions();
    const result = renderTag('v{version}', '1.0.0$&x');
    expect(result).toBe('v1.0.0$&x');
  });
});

describe('tag resolution: basic', SUITE_OPTS, () => {
  it('resolves an existing tag', async () => {
    expect.hasAssertions();
    const fixtureRepo = await createFixtureRepo({ tags: ['v1.0.0'] });

    const result = await resolveTag(runner, fixtureRepo.dir, 'v{version}', '1.0.0');

    expect(result).toBe('v1.0.0');
  });

  it('throws for missing version', async () => {
    expect.hasAssertions();
    const fixtureRepo = await createFixtureRepo({ tags: ['v1.0.0'] });

    await expect(resolveTag(runner, fixtureRepo.dir, 'v{version}', '9.9.9')).rejects.toThrow(
      "tag 'v9.9.9' not found",
    );
  });

  // Regression test: a version carrying git revision syntax (e.g. `1.0.0^{}`) renders to
  // `v1.0.0^{}`, which `rev-parse --verify` used to peel against the real `v1.0.0` tag. `tagExists`
  // now checks the literal ref via `show-ref --verify`, so this must not resolve.
  it('rejects a version containing git revision syntax, even when the base tag exists', async () => {
    expect.hasAssertions();
    const fixtureRepo = await createFixtureRepo({ tags: ['v1.0.0'] });

    await expect(resolveTag(runner, fixtureRepo.dir, 'v{version}', '1.0.0^{}')).rejects.toThrow(
      "tag 'v1.0.0^{}' not found",
    );
  });
});

describe('tag resolution: error messages', SUITE_OPTS, () => {
  it('includes dir in error message', async () => {
    expect.hasAssertions();
    const fixtureRepo = await createFixtureRepo({ tags: ['v1.0.0'] });

    const caughtError = await resolveTagForTest({
      dir: fixtureRepo.dir,
      format: 'v{version}',
      version: '9.9.9',
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain(fixtureRepo.dir);
    expect((caughtError as Error).message).toContain('check the version or tag_format');
  });

  it('reports missing tag in error message', async () => {
    expect.hasAssertions();
    const fixtureRepo = await createFixtureRepo({ tags: ['v1.0.0'] });

    const caughtError = await resolveTagForTest({
      dir: fixtureRepo.dir,
      format: 'v{version}',
      version: '9.9.9',
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain('v9.9.9');
  });
});
