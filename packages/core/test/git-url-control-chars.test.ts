import { describe, expect, it } from 'vitest';
import { canonicalizeGitUrl } from '../src/git-url.ts';

// `canonicalizeGitUrl` returns the RAW input as `cloneUrl` while deriving the stored key from the
// WHATWG-parsed pathname, so anything the parser silently removes can make those two name different
// repositories. The backslash and percent guards close that door twice; these are the rest of it.
// Confirmed with `git fetch-pack --diag-url` that git really does ask the server for the literal
// path in each case, so the divergence is a checkout whose recorded identity names another repo.

const C0_COUNT = 32;
const DEL = 127;
const CONTROLS = [...Array.from({ length: C0_COUNT }, (_unused, code) => code), DEL];

const CODE_TAB = 9;
const CODE_LF = 10;
const CODE_CR = 13;
const TAB = String.fromCodePoint(CODE_TAB);
const LF = String.fromCodePoint(CODE_LF);
const CR = String.fromCodePoint(CODE_CR);

const throwsFor =
  (raw: string): (() => unknown) =>
  () =>
    canonicalizeGitUrl(raw, { allowFileUrls: true });

describe('control characters in a git url', () => {
  it('rejects every C0 code point and DEL, wherever it sits', () => {
    expect.hasAssertions();
    const accepted = CONTROLS.filter((code) => {
      try {
        canonicalizeGitUrl(`https://example.com/org/re${String.fromCodePoint(code)}po.git`);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toStrictEqual([]);
  });

  it.each([
    ['tab', TAB],
    ['line feed', LF],
    ['carriage return', CR],
  ])('rejects a dot segment hidden by a %s', (_name, separator) => {
    expect.hasAssertions();
    expect(throwsFor(`https://example.com/org/attacker/.${separator}./victim.git`)).toThrow(
      'control character',
    );
  });

  it('names the code point and never echoes the url that carries it', () => {
    expect.hasAssertions();
    const secret = 'sekrit';
    let message = '';
    try {
      canonicalizeGitUrl(`https://user:${secret}@example.com/org/re${TAB}po.git`);
    } catch (error) {
      ({ message } = error as Error);
    }
    expect(message).toBe('not a supported git url: control character U+0009 at position 38');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('example.com');
  });

  it('is checked before the other raw-input guards', () => {
    expect.hasAssertions();
    // Both a control character and a backslash: the control-character message must win, because it
    // is the one that must not echo the url.
    expect(throwsFor(`https://example.com/org/a${TAB}b\\c.git`)).toThrow('control character');
  });
});

describe('boundary spaces and url delimiters', () => {
  it('rejects a trailing space, which the parser strips before resolving dot segments', () => {
    expect.hasAssertions();
    expect(throwsFor('ssh://git@example.com/org/repo/attacker/.. ')).toThrow(
      'leading or trailing space',
    );
  });

  it('rejects a leading space', () => {
    expect.hasAssertions();
    expect(throwsFor(' https://example.com/org/repo.git')).toThrow('leading or trailing space');
  });

  it.each([
    ['fragment', 'ssh://git@example.com/org/victim.git#attacker'],
    ['query', 'ssh://git@example.com/org/victim.git?attacker'],
    ['bare fragment delimiter', 'ssh://git@example.com/org/victim.git#'],
  ])('rejects a %s, which never reaches the derived key', (_name, raw) => {
    expect.hasAssertions();
    expect(throwsFor(raw)).toThrow('query or fragment');
  });
});

describe('urls that must keep working', () => {
  it.each([
    ['https', 'https://example.com/org/repo.git', 'example.com/org/repo'],
    ['scp form', 'git@example.com:org/repo.git', 'example.com/org/repo'],
    ['file with an interior space', 'file:///Users/me/My Repos/thing', 'local/My Repos/thing'],
    ['file percent-encoded', 'file:///Users/me/My%20Repos/thing', 'local/My Repos/thing'],
  ])('accepts %s', (_name, raw, key) => {
    expect.hasAssertions();
    expect(canonicalizeGitUrl(raw, { allowFileUrls: true }).key).toBe(key);
  });
});
