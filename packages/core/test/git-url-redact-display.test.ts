import { describe, expect, it } from 'vitest';
import { redactUrlForDisplay } from '../src/git-url-redact.ts';

// `redactUrl` is for error messages and is deliberately maximal: everything up to the LAST `@`.
// A url being DISPLAYED needs a narrower rule, because `git@host` is the documented ssh form.
//
// The decision is made on the PARSED url, not by matching the string. Userinfo runs to the last `@`
// before the authority ends; a password may contain an `@`; a leading space, or a space inside the
// userinfo, still parses. A pattern that gets any of those wrong fails OPEN, and for a credential
// that is the wrong direction — so anything that neither parses nor matches the scp form falls back
// to the maximal redaction instead of being printed.

const READABLE: readonly [string, string][] = [
  ['plain https', 'https://github.com/owner/repo.git'],
  ['the scp form with the conventional user', 'git@github.com:owner/repo.git'],
  ['an ssh url with the conventional user', 'ssh://git@github.com/owner/repo.git'],
  ['a file url', 'file:///Users/me/repos/thing'],
  ['an @ that is only in the path', 'https://example.com/o/re@po.git'],
  ['a host:path form whose @ is in the path', 'example.com:repo@v1.git'],
];

const REDACTED: readonly [string, string, string][] = [
  [
    'an ssh username that is not the convention',
    'ssh://DEPLOY_TOKEN@example.com/o/r.git',
    'ssh://<redacted>@example.com/o/r.git',
  ],
  [
    'an https password',
    'https://user:PASSWORD@example.com/o/r.git',
    'https://<redacted>@example.com/o/r.git',
  ],
  [
    'a password containing an @ of its own',
    'https://user:p@ssWORD@example.com/r.git',
    'https://<redacted>@example.com/r.git',
  ],
  [
    'a username that only starts with the convention',
    'ssh://git@TOKEN@example.com/r.git',
    'ssh://<redacted>@example.com/r.git',
  ],
  [
    'a url with a leading space, which still parses',
    ' https://user:PASSWORD@example.com/r.git',
    'https://<redacted>@example.com/r.git',
  ],
  [
    'a space inside the userinfo, which still parses',
    'https://user:PASS WORD@example.com/r.git',
    'https://<redacted>@example.com/r.git',
  ],
  [
    'the conventional name over a transport where the convention does not apply',
    'https://git@example.com/o/r.git',
    'https://<redacted>@example.com/o/r.git',
  ],
];

describe('redacting a url for display', () => {
  it.each(READABLE)('leaves %s readable', (_name, url) => {
    expect.hasAssertions();
    expect(redactUrlForDisplay(url)).toBe(url);
  });

  it.each(REDACTED)('redacts %s', (_name, url, expected) => {
    expect.hasAssertions();
    expect(redactUrlForDisplay(url)).toBe(expected);
  });

  it('handles an IPv6 host on both sides of the decision', () => {
    expect.hasAssertions();
    expect(redactUrlForDisplay('ssh://git@[2001:db8::1]/o/r.git')).toBe(
      'ssh://git@[2001:db8::1]/o/r.git',
    );
    expect(redactUrlForDisplay('ssh://TOKEN@[2001:db8::1]/o/r.git')).toBe(
      'ssh://<redacted>@[2001:db8::1]/o/r.git',
    );
  });

  it('falls back to the maximal redaction for something it cannot parse', () => {
    expect.hasAssertions();
    // Neither a url nor the scp form: the userinfo cannot be identified, so nothing is assumed.
    expect(redactUrlForDisplay('not a url at all SECRET@host')).toContain('<redacted>@');
  });
});
