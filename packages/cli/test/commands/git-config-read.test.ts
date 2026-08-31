import { describe, expect, it } from 'vitest';
import { readGitConfigValues } from '../../src/commands/git-config-read.ts';

// Establishing a checkout's identity means reading two values out of `.git/config` without spawning
// git. Every case below is a shape git accepts and a line-matching implementation would get wrong —
// which is the entire reason this is a parser rather than a grep.

const MARKER = 'core.hookspath';
const ORIGIN = 'remote.origin.url';
const WANTED = [MARKER, ORIGIN];
const BOTH_DUPLICATES = 2;

describe('reading a value git would honour', () => {
  it('matches section and variable names case-insensitively', () => {
    expect.hasAssertions();
    // Git compares both case-insensitively, so `[CORE] HooksPath` is the same setting as
    // `[core] hooksPath`. A grep for the literal spelling would miss it.
    const found = readGitConfigValues('[CORE]\n\tHooksPath = /hooks\n', WANTED);

    expect(found.get(MARKER)).toStrictEqual(['/hooks']);
  });

  it('ignores a comment that mentions the setting', () => {
    expect.hasAssertions();
    const found = readGitConfigValues(
      '# hooksPath = /decoy\n[core]\n\thooksPath = /real\n',
      WANTED,
    );

    expect(found.get(MARKER)).toStrictEqual(['/real']);
  });

  it('strips a trailing comment from a value', () => {
    expect.hasAssertions();
    const found = readGitConfigValues('[core]\n\thooksPath = /real ; and a note\n', WANTED);

    expect(found.get(MARKER)).toStrictEqual(['/real']);
  });

  it('unquotes a quoted value and keeps a # inside the quotes', () => {
    expect.hasAssertions();
    // Whether a `#` starts a comment depends on the quoting state, which is why comment stripping
    // and unquoting have to happen in one pass.
    const found = readGitConfigValues('[core]\n\thooksPath = "/ho#oks"\n', WANTED);

    expect(found.get(MARKER)).toStrictEqual(['/ho#oks']);
  });

  it('joins a value continued onto the next line', () => {
    expect.hasAssertions();
    const found = readGitConfigValues('[core]\n\thooksPath = /ho\\\noks\n', WANTED);

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

    const found = readGitConfigValues(config, WANTED);

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

    expect(readGitConfigValues(config, WANTED).get(ORIGIN)).toHaveLength(BOTH_DUPLICATES);
  });

  it('reports nothing for a key that is absent', () => {
    expect.hasAssertions();

    expect(readGitConfigValues('[core]\n\trepositoryformatversion = 0\n', WANTED).size).toBe(0);
  });
});
