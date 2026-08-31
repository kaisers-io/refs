import { describe, expect, it } from 'vitest';
import { readGitConfigValues } from '../../src/commands/git-config-read.ts';

// Establishing a checkout's identity means reading two values out of `.git/config` without spawning
// git. Every case below is a shape git accepts and a line-matching implementation would get wrong —
// which is the entire reason this is a parser rather than a grep.

const MARKER = 'core.hookspath';
const ORIGIN = 'remote.origin.url';
const WANTED = [MARKER, ORIGIN];
const BOTH_DUPLICATES = 2;

/** The reader returns `undefined` for a file git would reject; these cases are about what it
 * ACCEPTS, so they assert on a successful read. */
const read = (config: string): ReadonlyMap<string, string[]> => {
  const found = readGitConfigValues(config, WANTED);
  if (found === undefined) {
    throw new Error('expected this config to parse');
  }
  return found;
};

describe('reading a value git would honour', () => {
  it('matches section and variable names case-insensitively', () => {
    expect.hasAssertions();
    // Git compares both case-insensitively, so `[CORE] HooksPath` is the same setting as
    // `[core] hooksPath`. A grep for the literal spelling would miss it.
    const found = read('[CORE]\n\tHooksPath = /hooks\n');

    expect(found.get(MARKER)).toStrictEqual(['/hooks']);
  });

  it('ignores a comment that mentions the setting', () => {
    expect.hasAssertions();
    const found = read('# hooksPath = /decoy\n[core]\n\thooksPath = /real\n');

    expect(found.get(MARKER)).toStrictEqual(['/real']);
  });

  it('strips a trailing comment from a value', () => {
    expect.hasAssertions();
    const found = read('[core]\n\thooksPath = /real ; and a note\n');

    expect(found.get(MARKER)).toStrictEqual(['/real']);
  });

  it('unquotes a quoted value and keeps a # inside the quotes', () => {
    expect.hasAssertions();
    // Whether a `#` starts a comment depends on the quoting state, which is why comment stripping
    // and unquoting have to happen in one pass.
    const found = read('[core]\n\thooksPath = "/ho#oks"\n');

    expect(found.get(MARKER)).toStrictEqual(['/ho#oks']);
  });

  it('accepts a comment after a section header, which git allows', () => {
    expect.hasAssertions();
    // Rejecting this would turn a perfectly valid managed checkout into `unverifiable`, and
    // `--sync-if-stale` would then refuse to update it.
    const found = read('[core] # local settings\n\thooksPath = /hooks\n');

    expect(found.get(MARKER)).toStrictEqual(['/hooks']);
  });

  it('joins a value continued onto the next line', () => {
    expect.hasAssertions();
    const found = read('[core]\n\thooksPath = /ho\\\noks\n');

    expect(found.get(MARKER)).toStrictEqual(['/hooks']);
  });
});

describe('telling one remote from another', () => {
  it('matches the origin subsection case-sensitively and ignores other remotes', () => {
    expect.hasAssertions();
    // Subsection names, unlike section names, ARE case-sensitive in git. And a second remote must
    // never stand in for origin — "some remote with a plausible url" is not an identity check.
    const config = [
      '[remote "upstream"]',
      '\turl = https://example.com/decoy.git',
      '[remote "ORIGIN"]',
      '\turl = https://example.com/wrong-case.git',
      '[remote "origin"]',
      '\turl = https://example.com/real.git',
      '',
    ].join('\n');

    const found = read(config);

    expect(found.get(ORIGIN)).toStrictEqual(['https://example.com/real.git']);
  });

  it('returns every occurrence, so a caller can refuse to guess between duplicates', () => {
    expect.hasAssertions();
    // Two origins means something other than refs wrote this config. Which one git would honour is
    // not a safe basis for handing out a path, so the caller fails closed — it can only do that if
    // both are reported.
    const config = [
      '[remote "origin"]',
      '\turl = https://example.com/one.git',
      '[remote "origin"]',
      '\turl = https://example.com/two.git',
      '',
    ].join('\n');

    expect(read(config).get(ORIGIN)).toHaveLength(BOTH_DUPLICATES);
  });

  it('reports nothing for a key that is absent', () => {
    expect.hasAssertions();

    expect(read('[core]\n\trepositoryformatversion = 0\n').size).toBe(0);
  });
});

describe('keeping quoted whitespace, which git treats as significant', () => {
  it('does not trim a quoted subsection down to a different one', () => {
    expect.hasAssertions();
    // Git treats `[remote " origin "]` as a subsection distinct from `origin`. Trimming it would
    // let a config that declares only `" origin "` satisfy a check for `origin` — so a checkout
    // with no origin remote at all would read as this ref's.
    const found = read('[remote " origin "]\n\turl = https://example.com/x.git\n');

    expect(found.get(ORIGIN)).toBeUndefined();
  });

  it('keeps whitespace inside a quoted value', () => {
    expect.hasAssertions();
    const found = read('[core]\n\thooksPath = " /ho oks "\n');

    expect(found.get(MARKER)).toStrictEqual([' /ho oks ']);
  });

  it('still drops whitespace outside quotes', () => {
    expect.hasAssertions();
    const found = read('[core]\n\thooksPath =   /hooks   \n');

    expect(found.get(MARKER)).toStrictEqual(['/hooks']);
  });

  it('does not continue a line whose trailing backslash is inside a comment', () => {
    expect.hasAssertions();
    // Verified against `git config --file --get-all`: git reads both assignments here and resolves
    // the setting to the SECOND. Joining the lines before stripping the comment would show only
    // `/expected` — hiding both the value git actually uses and the duplicate that makes the read
    // fail closed. A config could then present the expected marker while git identified the
    // repository as something else.
    const found = read('[core]\n\thooksPath = /expected # note \\\n\thooksPath = /attacker\n');

    expect(found.get(MARKER)).toStrictEqual(['/expected', '/attacker']);
  });

  it('reads a line ending in an escaped backslash as a value, not a continuation', () => {
    expect.hasAssertions();
    // `\\` at end of line is a literal backslash to git; only an ODD number of trailing
    // backslashes escapes the newline. Joining here would swallow the next section header and
    // condemn a perfectly valid config as malformed.
    const found = read('[core]\n\thooksPath = C:\\\\\n[remote "origin"]\n\turl = https://e/x\n');

    expect(found.get(ORIGIN)).toStrictEqual(['https://e/x']);
  });
});

describe("using git's notion of whitespace, not JavaScript's", () => {
  it('does not strip a unicode space, which git would keep', () => {
    expect.hasAssertions();
    // JS `\s` covers unicode spaces; git's config whitespace is space and tab only. Trimming one
    // here would make a value match that git reads as different.
    const found = read('[core]\n\thooksPath = /hooks\u00A0\n');

    expect(found.get(MARKER)).toStrictEqual(['/hooks\u00A0']);
  });
});

describe('refusing a config git would reject', () => {
  it.each([
    ['an unterminated quote', '[core]\n\thooksPath = "/hooks\n'],
    ['an escape git does not define', '[core]\n\thooksPath = /ho\\qoks\n'],
    ['a line that is neither a section nor an assignment', '[core]\nnot a setting!\n'],
    ['an assignment before any section header', 'hooksPath = /hooks\n[core]\n'],
    ['an underscore in a section name', '[co_re]\n\thooksPath = /hooks\n'],
    ['an underscore in a variable name', '[core]\n\thooks_path = /hooks\n'],
  ])('returns nothing for %s', (_label, config) => {
    expect.hasAssertions();

    // Skipping the bad line instead would let a corrupt or crafted config still yield the marker
    // and origin, and so still be reported as a managed checkout. The whole reason for reading this
    // file is to establish identity; a file git would not accept is not evidence of any.
    expect(readGitConfigValues(config, WANTED)).toBeUndefined();
  });
});
