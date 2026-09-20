import { describe, expect, it } from 'vitest';
import { detectTagFormatForVersion } from '../../src/git/tag-format-version.ts';

/** Past the length cap the detector applies, without restating the cap itself. */
const OVERLONG_IDENTIFIER_LENGTH = 100;

// Deriving a tag format from a version a package is known to be at, rather than from how often a
// shape occurs. The cases here are the ones that decide whether an answer is evidence or a guess.

describe('a tag that carries the package name', () => {
  it('wins over the repository-wide one at the same version', () => {
    expect.hasAssertions();

    // Both tags exist and both carry 1.2.3. Only one of them is this package's release.
    expect(detectTagFormatForVersion(['v1.2.3', 'pkg@1.2.3'], '1.2.3', 'pkg')).toBe(
      'pkg@{version}',
    );
  });

  it('is accepted with a `v` between the separator and the version', () => {
    expect.hasAssertions();

    expect(detectTagFormatForVersion(['pkg@v1.2.3'], '1.2.3', 'pkg')).toBe('pkg@v{version}');
  });

  it('is matched in full, so a sibling cannot claim a scoped package by its bare name', () => {
    expect.hasAssertions();

    // `@acme/core` and a sibling literally named `core`, both at 1.2.3. Trimming the scope off
    // would hand `@acme/core` the sibling's tag; the repository-wide `v1.2.3` is its own release.
    expect(detectTagFormatForVersion(['v1.2.3', 'core@1.2.3'], '1.2.3', '@acme/core')).toBe(
      'v{version}',
    );
  });
});

describe('a tag that carries a different package name', () => {
  it('is never the answer, even when it is the only tag at that version', () => {
    expect.hasAssertions();

    // This is the mistake counting makes, reproduced at one version. `null` sends the caller back
    // to `detectTagFormat`, which is no worse than before; `other@{version}` would be worse.
    expect(detectTagFormatForVersion(['other@1.2.3'], '1.2.3', 'wanted')).toBeNull();
  });
});

describe('two spellings of the same release', () => {
  it('produce nothing rather than a coin flip', () => {
    expect.hasAssertions();

    expect(detectTagFormatForVersion(['pkg@1.2.3', 'pkg@v1.2.3'], '1.2.3', 'pkg')).toBeNull();
  });
});

describe('a version that only looks like it is there', () => {
  it('is not matched inside a longer number', () => {
    expect.hasAssertions();

    // `v1.2.0.0` ends with the characters `2.0.0` and has nothing to do with version 2.0.0.
    expect(detectTagFormatForVersion(['v1.2.0.0'], '2.0.0', 'pkg')).toBeNull();
  });

  it('is not matched when the tag merely contains it somewhere', () => {
    expect.hasAssertions();

    // The format has to render back to a real tag, so a version in the middle is not an anchor.
    expect(detectTagFormatForVersion(['v1.2.3-patched'], '1.2.3', 'pkg')).toBeNull();
  });
});

describe('a tag that embeds a second version in front of the one anchored on', () => {
  it('yields nothing, rather than a format with a version pinned inside it', () => {
    expect.hasAssertions();

    // `compare-1.2.3-to-{version}` passes every other check and renders back to its own tag. It is
    // still not a format: the version it keeps would be wrong for every other release.
    expect(detectTagFormatForVersion(['compare-1.2.3-to-1.2.3'], '1.2.3', 'x')).toBeNull();
  });
});

describe('a tag the config could not hold', () => {
  it('is refused rather than stored', () => {
    expect.hasAssertions();

    // A lone surrogate does not survive being written to `config.toml` and read back, which is
    // what `zStorableText` is about. Nothing decodes a git tag into one today; the guard is here
    // so that a format is never stored on the strength of where it came from.
    expect(detectTagFormatForVersion(['\uD800-1.2.3'], '1.2.3', 'pkg')).toBeNull();
  });
});

describe('a tag that spells the placeholder itself', () => {
  it('is refused, because the format it yields renders to something else', () => {
    expect.hasAssertions();

    // `{version}1.2.3` would become `{version}{version}`, which renders `1.2.31.2.3`.
    expect(detectTagFormatForVersion(['{version}1.2.3'], '1.2.3', 'pkg')).toBeNull();
  });
});

describe('without a package name to go on', () => {
  it('still answers when only the repository-wide form carries the version', () => {
    expect.hasAssertions();

    expect(detectTagFormatForVersion(['v1.2.3', 'other@1.2.3'], '1.2.3')).toBe('v{version}');
  });
});

describe('a version string that is not one', () => {
  it.each([
    ['empty', ''],
    ['not a triple', 'latest'],
    ['two parts only', '1.2'],
    ['longer than any release', `1.2.3-${'a'.repeat(OVERLONG_IDENTIFIER_LENGTH)}`],
  ])('is refused (%s)', (_label, version) => {
    expect.hasAssertions();

    expect(detectTagFormatForVersion([`v${version}`], version, 'pkg')).toBeNull();
  });
});

describe('a prerelease version', () => {
  it('anchors like any other', () => {
    expect.hasAssertions();

    expect(
      detectTagFormatForVersion(
        ['effect@4.0.0-rc.116', '@effect/platform-node@4.0.0-rc.116'],
        '4.0.0-rc.116',
        'effect',
      ),
    ).toBe('effect@{version}');
  });
});
