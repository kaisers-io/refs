import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/git-url-redact.ts';

// Direct unit suite for `redactUrl` — review round 2 (Task 30) proved the first implementation's
// non-global, start-anchored patterns let secrets through on inputs that aren't a single
// well-formed url (exactly what this helper exists for: `git remote get-url` output and other
// arbitrary strings). Every case here is a PROVEN leak vector from that review; redaction is
// allowed to be lossy on garbage input, so these assert only that the secret is gone and that a
// `<redacted>` marker appears — never an exact output shape.

const SECRETS = ['sekrit', 'sekrit2'];

// [input, proven leak it regression-tests]
const LEAK_VECTORS: readonly [string, string][] = [
  [
    'https://user:sekrit@a/x ssh://user2:sekrit2@b/y',
    'two credentialed urls in one string — a non-global replace only caught the first',
  ],
  [
    'garbage sekrit@evil.com not a url',
    'bare userinfo not at index 0 — a start-anchored bare pattern never fired',
  ],
  [
    'ht!tp://user:sekrit @host/a/b',
    'whitespace before the @ separator defeated the no-whitespace character class',
  ],
  ['https://user:sekrit@github.com/a/b', 'the plain single-url form must keep working'],
  ['git@host:path/repo', 'the bare scp form must keep working'],
];

describe('redactUrl leaves no secret behind', () => {
  it.each(LEAK_VECTORS)('redacts every userinfo occurrence in %s (%s)', (raw) => {
    expect.hasAssertions();
    const redacted = redactUrl(raw);
    for (const secret of SECRETS.filter((candidate) => raw.includes(candidate))) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain('<redacted>@');
  });

  it('passes strings without any @ through unchanged', () => {
    expect.hasAssertions();
    expect(redactUrl('https://github.com/vercel/next.js')).toBe(
      'https://github.com/vercel/next.js',
    );
  });
});

const MAX_REDACTED_LENGTH = 200;

describe('redactUrl truncation', () => {
  it('caps an overlong redacted string at 200 chars plus an ellipsis', () => {
    expect.hasAssertions();
    const overlong = `https://user:sekrit@host/${'a'.repeat(MAX_REDACTED_LENGTH)}`;
    const redacted = redactUrl(overlong);
    expect(redacted).toHaveLength(MAX_REDACTED_LENGTH + '…'.length);
    expect(redacted.endsWith('…')).toBe(true);
    expect(redacted).not.toContain('sekrit');
  });
});
