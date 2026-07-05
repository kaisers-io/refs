import { applyGitTransport, canonicalizeGitUrl } from '../src/git-url.ts';
import { describe, expect, it } from 'vitest';

const ACCEPTED_CASES: readonly [string, string, string][] = [
  [
    'https://github.com/vercel/next.js',
    'github.com/vercel/next.js',
    'https://github.com/vercel/next.js',
  ],
  [
    'https://GitHub.com/Vercel/Next.js.git',
    'github.com/Vercel/Next.js',
    'https://GitHub.com/Vercel/Next.js.git',
  ],
  [
    'git@github.com:vercel/next.js.git',
    'github.com/vercel/next.js',
    'git@github.com:vercel/next.js.git',
  ],
  [
    'ssh://git@gitlab.com/group/sub/repo.git',
    'gitlab.com/group/sub/repo',
    'ssh://git@gitlab.com/group/sub/repo.git',
  ],
  [
    'ssh://git@git.example.io:2222/team/repo',
    'git.example.io_2222/team/repo',
    'ssh://git@git.example.io:2222/team/repo',
  ],
  ['ssh://git@github.com:22/o/r', 'github.com/o/r', 'ssh://git@github.com:22/o/r'],
  [
    'git+https://github.com/facebook/react.git',
    'github.com/facebook/react',
    'https://github.com/facebook/react.git',
  ],
  ['git+ssh://git@github.com/o/r.git', 'github.com/o/r', 'ssh://git@github.com/o/r.git'],
  [
    'https://gitlab.mycompany.io/gitlab/group/sub/repo',
    'gitlab.mycompany.io/gitlab/group/sub/repo',
    'https://gitlab.mycompany.io/gitlab/group/sub/repo',
  ],
];

const REJECTED_CASES: readonly [string, string][] = [
  ['ftp://github.com/a/b', 'unsupported protocol'],
  ['github.com/a/b', 'no scheme'],
  ['https://github.com/onlyowner', 'too few path segments'],
  ['https://github.com/a/b/../c', 'literal double-dot segment'],
  ['git@github.com:a', 'too few scp path segments'],
  ['https://user:pass@github.com/a/b', 'https credentials'],
  ['', 'empty string'],
  [
    'https://github.com/a/%2e%2e/c/d',
    'percent-encoded double-dot segment (rejected under the reject-all-% rule)',
  ],
  [
    'https://github.com/a/b%2e%2e',
    'percent-encoded segment that decodes to a non-dot value (still rejected under the reject-all-% rule, since any % in a non-file url is untrusted)',
  ],
  [
    String.raw`https://github.com/a/b\..\c/d`,
    'backslash treated as path separator by WHATWG on https',
  ],
  ['git@github.com:/owner/repo.git', 'scp path starting with / collides with the relative form'],
  ['git@github.com:~/owner/repo', 'scp path starting with ~ is ambiguous home-relative form'],
  ['git@host:2222:path/repo', 'internal colon in scp path is ambiguous with a port'],
  ['ssh://git:s3cr3t@github.com/o/r', 'ssh url with embedded password'],
];

const FILE_URL_CASES: readonly [string, string][] = [
  ['file:///tmp/fix-abc/myrepo', 'local/fix-abc/myrepo'],
  ['file:///tmp/a/b/', 'local/a/b'],
];

// Secret-echo regression (Task 30): `assertNoBackslash`/`assertNoPercentEncodingUnlessFile`/
// `parseUrl` all run BEFORE `assertNoCredentials` ever gets a chance to reject an embedded
// password, so a url combining one of those guard triggers WITH embedded credentials must still
// never echo the password into the thrown message.
const CREDENTIALED_LEAK_CASES: readonly [string, string][] = [
  [
    String.raw`https://user:sekrit@github.com/a\..\b`,
    'backslash guard fires before the credentials guard',
  ],
  [
    'https://user:sekrit@github.com/a/%2e%2e/c',
    'percent-encoding guard fires before the credentials guard',
  ],
  ['ht!tp://user:sekrit@host/a/b', 'an unparseable url still echoes raw input by default'],
  [
    'ssh:/user:sekrit@host/owner/repo',
    'authority-less ssh url (review round 2) — WHATWG parses the credentials into pathname ' +
      '(username/password stay empty, so assertNoCredentials never fires) and parseAsRefKey ' +
      'used to echo the derived key verbatim',
  ],
];

const messageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

// Runs `thunk`, returning the thrown error's message rather than letting it propagate — every
// `CREDENTIALED_LEAK_CASES` entry is known to throw, so a thunk that DOESN'T throw is itself a
// test failure (surfaced here rather than via a silently-vacuous assertion below).
const throwMessage = (thunk: () => unknown): string => {
  try {
    thunk();
  } catch (error) {
    return messageOf(error);
  }
  throw new Error('expected thunk to throw');
};

describe('canonicalizeGitUrl accepted forms', () => {
  it.each(ACCEPTED_CASES)('%s → key %s', (input, key, cloneUrl) => {
    expect.hasAssertions();
    expect(canonicalizeGitUrl(input)).toStrictEqual({ cloneUrl, key });
  });
});

describe('canonicalizeGitUrl rejected forms', () => {
  it.each(REJECTED_CASES)('rejects %s (%s)', (bad) => {
    expect.hasAssertions();
    expect(() => canonicalizeGitUrl(bad)).toThrow(/not a supported git url|validation/iu);
  });
});

describe('canonicalizeGitUrl never echoes embedded credentials', () => {
  it.each(CREDENTIALED_LEAK_CASES)('rejects %s without leaking the password (%s)', (bad) => {
    expect.hasAssertions();
    const message = throwMessage(() => canonicalizeGitUrl(bad));
    expect(message).toMatch(/not a supported git url/u);
    expect(message).not.toContain('sekrit');
  });

  // The parseAsRefKey echo is also reachable through the buildFileKey caller (review round 2) —
  // a file url whose decoded path fails zRefKey used to land verbatim in the derived-key message.
  it('rejects a credentialed-looking file url path without leaking it (allowFileUrls)', () => {
    expect.hasAssertions();
    const message = throwMessage(() =>
      canonicalizeGitUrl('file:///tmp/user:sekrit@x/repo', { allowFileUrls: true }),
    );
    expect(message).toMatch(/not a supported git url/u);
    expect(message).not.toContain('sekrit');
  });
});

describe('canonicalizeGitUrl file url opt-in', () => {
  it.each(FILE_URL_CASES)('accepts %s with allowFileUrls flag → key %s', (input, key) => {
    expect.hasAssertions();
    expect(canonicalizeGitUrl(input, { allowFileUrls: true })).toStrictEqual({
      cloneUrl: input,
      key,
    });
  });

  it('rejects file urls when allowFileUrls flag is absent', () => {
    expect.hasAssertions();
    expect(() => canonicalizeGitUrl('file:///tmp/fix-abc/myrepo')).toThrow(
      /not a supported git url|validation/iu,
    );
  });

  it('rejects file urls when allowFileUrls flag is explicitly false', () => {
    expect.hasAssertions();
    expect(() =>
      canonicalizeGitUrl('file:///tmp/fix-abc/myrepo', { allowFileUrls: false }),
    ).toThrow(/not a supported git url|validation/iu);
  });

  it('rejects file urls with fewer than 2 usable path segments even with allowFileUrls', () => {
    expect.hasAssertions();
    expect(() => canonicalizeGitUrl('file:///x', { allowFileUrls: true })).toThrow(
      /not a supported git url|validation/iu,
    );
  });
});

// [input, transport, expected output] — every transformed case must also be key-invariant,
// asserted separately below via canonicalizeGitUrl round-trips.
const TRANSPORT_CASES: readonly [string, 'https' | 'ssh', string][] = [
  // Rewriting https → ssh yields the scp form with a .git suffix (spec §3 amended transport rule).
  ['https://github.com/example/demo.git', 'ssh', 'git@github.com:example/demo.git'],
  ['https://github.com/vercel/next.js', 'ssh', 'git@github.com:vercel/next.js.git'],
  // Host is lowercased in the rewrite target; path case is preserved verbatim (mirrors the base
  // canonicalizeGitUrl suite's own uppercase-host `ACCEPTED_CASES` entry).
  ['https://GitHub.com/Owner/repo', 'ssh', 'git@github.com:Owner/repo.git'],
  [
    'https://gitlab.mycompany.io/gitlab/group/sub/repo',
    'ssh',
    'git@gitlab.mycompany.io:gitlab/group/sub/repo.git',
  ],
  // Rewriting ssh (either form) → https keeps the path verbatim.
  ['git@github.com:vercel/next.js.git', 'https', 'https://github.com/vercel/next.js.git'],
  ['ssh://git@gitlab.com/group/sub/repo.git', 'https', 'https://gitlab.com/group/sub/repo.git'],
  // Default ports are stripped by the transform, matching key canonicalization.
  ['ssh://git@github.com:22/o/r', 'https', 'https://github.com/o/r'],
  ['https://github.com:443/o/r.git', 'ssh', 'git@github.com:o/r.git'],
  // Already on the requested transport → returned verbatim, byte for byte.
  ['https://github.com/example/demo.git', 'https', 'https://github.com/example/demo.git'],
  ['git@github.com:example/demo.git', 'ssh', 'git@github.com:example/demo.git'],
  ['ssh://git@git.example.io:2222/team/repo', 'ssh', 'ssh://git@git.example.io:2222/team/repo'],
  // file:// urls are exempt (test-only escape hatch; npm resolution can never produce one).
  ['file:///tmp/fix-abc/myrepo', 'ssh', 'file:///tmp/fix-abc/myrepo'],
  ['file:///tmp/fix-abc/myrepo', 'https', 'file:///tmp/fix-abc/myrepo'],
];

const TRANSPORT_REJECTED_CASES: readonly [string, 'https' | 'ssh', string][] = [
  [
    'ssh://git@git.example.io:2222/team/repo',
    'https',
    'non-default ssh port cannot be expressed in an https url',
  ],
  [
    'https://git.example.io:8443/team/repo',
    'ssh',
    'non-default https port cannot be expressed in the scp form',
  ],
];

describe('applyGitTransport url rewriting', () => {
  it.each(TRANSPORT_CASES)('%s + git_transport=%s → %s', (input, transport, expected) => {
    expect.hasAssertions();
    expect(applyGitTransport(input, transport)).toBe(expected);
  });

  it.each(TRANSPORT_CASES)(
    '%s + git_transport=%s keeps the canonical key unchanged',
    (input, transport) => {
      expect.hasAssertions();
      const opts = { allowFileUrls: true };
      const before = canonicalizeGitUrl(input, opts).key;
      const after = canonicalizeGitUrl(applyGitTransport(input, transport), opts).key;
      expect(after).toBe(before);
    },
  );

  it.each(TRANSPORT_REJECTED_CASES)('rejects %s + git_transport=%s (%s)', (input, transport) => {
    expect.hasAssertions();
    expect(() => applyGitTransport(input, transport)).toThrow(/port/u);
  });

  it('rejects urls that are not supported git urls at all', () => {
    expect.hasAssertions();
    expect(() => applyGitTransport('ftp://github.com/a/b', 'ssh')).toThrow(
      /not a supported git url/u,
    );
  });

  // A password-less ssh USERNAME legally survives canonicalization (only passwords are
  // rejected), so applyGitTransport's own error messages are a reachable echo path for a
  // token-shaped username (review round 3) — e.g. a registry-resolved ssh url with a
  // non-default port under git_transport=https.
  it('never echoes userinfo in the non-default-port rejection', () => {
    expect.hasAssertions();
    const message = throwMessage(() =>
      applyGitTransport('ssh://sekrit@example.com:2222/acme/widgets.git', 'https'),
    );
    expect(message).toMatch(/port/u);
    expect(message).not.toContain('sekrit');
  });
});
