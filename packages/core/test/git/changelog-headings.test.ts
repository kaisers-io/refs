import { describe, expect, it } from 'vitest';
import { extractChangelogExcerpt } from '../../src/git/changelog.ts';

// Unit suite for the BOUNDED version-heading match in changelog.ts (the shared-fixture cases in
// `range.test.ts` cover slicing/capping): a heading only matches when the version is neither
// preceded by `[0-9.]` nor followed by `[0-9A-Za-z-]` — so prerelease headings above the GA
// section, and superstring versions (`14.0.0` for `4.0.0`), can never be mistaken for the
// section boundary, while the common bracketed/prefixed/dated heading styles all still match.

const MAX_CHARS = 4000;

const optsFor = (newVersion: string, oldVersion: string) => ({
  maxChars: MAX_CHARS,
  newVersion,
  oldVersion,
});

const RC_ABOVE_GA = [
  '# Changelog',
  '',
  '## 4.0.0-rc.1',
  '',
  '- rc only change',
  '',
  '## 4.0.0',
  '',
  '- GA change',
  '',
  '## 3.9.0',
  '',
  '- old change',
  '',
].join('\n');

describe('extractChangelogExcerpt: bounded version matching', () => {
  it('skips a prerelease heading above the GA section (4.0.0-rc.1 never matches 4.0.0)', () => {
    expect.hasAssertions();
    const result = extractChangelogExcerpt(RC_ABOVE_GA, optsFor('4.0.0', '3.9.0'));
    expect(result?.excerpt).toContain('GA change');
    expect(result?.excerpt).not.toContain('rc only change');
    expect(result?.excerpt).not.toContain('old change');
  });

  it('never matches a superstring version heading (14.0.0 is not 4.0.0)', () => {
    expect.hasAssertions();
    const content = ['# Changelog', '', '## 14.0.0', '', '- fourteen change', ''].join('\n');
    expect(extractChangelogExcerpt(content, optsFor('4.0.0', '3.9.0'))).toBeUndefined();
  });

  it.each(['## [4.0.0] - 2026-04-02', '## v4.0.0', '## 4.0.0 (2026-04-02)', '## 4.0.0'])(
    'still matches the common heading style %j',
    (heading) => {
      expect.hasAssertions();
      const content = ['# Changelog', '', heading, '', '- the change', ''].join('\n');
      const result = extractChangelogExcerpt(content, optsFor('4.0.0', '3.9.0'));
      expect(result?.excerpt).toContain('the change');
    },
  );

  it('matches a prerelease version exactly when it IS the requested version', () => {
    expect.hasAssertions();
    const result = extractChangelogExcerpt(RC_ABOVE_GA, optsFor('4.0.0-rc.1', '3.9.0'));
    expect(result?.excerpt).toContain('rc only change');
    expect(result?.excerpt).toContain('GA change');
    expect(result?.excerpt).not.toContain('old change');
  });
});

const NESTED_OLD_MENTION = [
  '# Changelog',
  '',
  '## 3.0.0',
  '',
  '- new feature',
  '',
  '### Migrating from 2.0.0',
  '',
  '- run the 2.0.0 codemod',
  '',
  '## 2.0.0',
  '',
  '- old change',
  '',
].join('\n');

const OLD_NESTED_DEEPER = [
  '# Changelog',
  '',
  '## 3.0.0',
  '',
  '- new feature',
  '',
  '## Historical releases',
  '',
  '### 2.0.0',
  '',
  '- old change',
  '',
].join('\n');

describe('extractChangelogExcerpt: section boundary depth', () => {
  it('does not end the section at a DEEPER sub-heading that merely mentions the old version', () => {
    expect.hasAssertions();
    // A `### Migrating from 2.0.0` sub-heading inside the `## 3.0.0` section is body content, not
    // the boundary — the migration notes are the most valuable part of a range query and must
    // survive. Only a heading at the new heading's depth or shallower (`## 2.0.0`) ends it.
    const result = extractChangelogExcerpt(NESTED_OLD_MENTION, optsFor('3.0.0', '2.0.0'));
    expect(result?.excerpt).toContain('new feature');
    expect(result?.excerpt).toContain('run the 2.0.0 codemod');
    expect(result?.excerpt).not.toContain('old change');
  });

  it('still bounds at a DEEPER old-release heading when none exists at the new depth', () => {
    expect.hasAssertions();
    // When the old release is nested deeper than the new one (grouped under a section heading)
    // and no same-or-shallower old heading exists, the boundary falls back to any depth so the
    // old release body is excluded, never leaked to end-of-file.
    const result = extractChangelogExcerpt(OLD_NESTED_DEEPER, optsFor('3.0.0', '2.0.0'));
    expect(result?.excerpt).toContain('new feature');
    expect(result?.excerpt).not.toContain('old change');
  });
});
