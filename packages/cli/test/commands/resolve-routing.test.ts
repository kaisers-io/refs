import { canonicalizeGitUrl, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// Review-round-fix coverage for `refs resolve` — split into its own file (rather than piled onto
// `resolve.test.ts` or `resolve-status.test.ts`) purely to keep both under the repo's 300-line
// oxlint cap, the same reason `resolve-status.test.ts` itself exists. Covers: `REFS_ALLOW_FILE_URLS`
// threading through to url-based routing (step 1), a url-looking query failing closed instead of
// falling through to steps 2-4 (including the credential-echo hardening), duplicate package names
// across refs being an ambiguity error (steps 2/3), the segment-boundary trap cases for step 3's
// prefix match, and the package-path `.` join-normalization case.

const NEXT_KEY = 'github.com/vercel/next.js';

const OTHER_KEY = 'github.com/acme/other';

const OTHER_ENTRY = {
  default_branch: 'main',
  description: 'Some other ref',
  tag_format: 'v{version}',
  url: 'https://github.com/acme/other',
};

const NEXT_ENTRY = {
  default_branch: 'canary',
  description: 'Next.js monorepo',
  packages: {
    '@next/env': { description: 'env loader', path: 'packages/next-env' },
    next: { description: 'the framework', path: 'packages/next' },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};

// Two refs that each register the SAME package name ('shared-pkg') — resolve's whole purpose is
// unambiguous agent routing, so this must be a routing error, never a silent "pick the
// lexicographically-first ref" fallback.
const SHARED_PKG_KEYS = ['github.com/acme/a', 'github.com/acme/b'] as const;

const SHARED_PKG_ENTRY_A = {
  default_branch: 'main',
  description: 'ref a',
  packages: { 'shared-pkg': { description: 'a copy', path: 'packages/shared' } },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/a',
};

const SHARED_PKG_ENTRY_B = {
  default_branch: 'main',
  description: 'ref b',
  packages: { 'shared-pkg': { description: 'b copy', path: 'packages/shared' } },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/b',
};

const NEXT_AUTH_ENTRY = {
  default_branch: 'main',
  description: 'next-auth',
  packages: { 'next-auth': { description: 'auth', path: 'packages/next-auth' } },
  tag_format: 'v{version}',
  url: 'https://github.com/nextauthjs/next-auth',
};

// A package registered at the ref root (path `.`) — Finding 5's join-normalization case:
// `join(dest, '.')` must equal `dest` itself, not `${dest}/.`.
const ROOT_PKG_ENTRY = {
  default_branch: 'main',
  description: 'root package ref',
  packages: { 'widget-root': { description: 'root pkg', path: '.' } },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/widget-root',
};

// A scoped package registered under `OTHER_KEY` — Finding 2's anchored-scheme regression case:
// `@scope/pkg/https://weird` must route to this package via prefix matching (step 3) rather than
// being misclassified as url-looking by an unanchored `://` scan and hard-failing in step 1.
const SCOPED_PKG_ENTRY = {
  default_branch: 'main',
  description: 'scoped package ref',
  packages: { '@scope/pkg': { description: 'a scoped pkg', path: 'packages/scoped' } },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/scoped',
};

type JsonEnvelope = {
  data: unknown;
  error?: { code: string; message: string };
  ok: boolean;
};

const parseSoleEnvelope = (stdout: readonly string[]): JsonEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as JsonEnvelope;
};

// Extracted to module scope (rather than inlined with `??` inside a test body) so
// `vitest/no-conditional-in-test` doesn't flag the nullish-coalescing fallback.
const messageOf = (envelope: JsonEnvelope): string => envelope.error?.message ?? '';

type SeedAndResolveOptions = {
  envExtra?: Record<string, string>;
  query: string;
  refs: Record<string, unknown>;
};

/** Seeds a fresh temp home's config with `options.refs`, runs `refs resolve <query> --json`
 * (optionally with extra env vars, e.g. `REFS_ALLOW_FILE_URLS`), and hands back both the parsed
 * envelope and the resolved `home` (needed by the join-normalization case for computing the
 * expected checkout path) — the common scaffolding every case below starts from. */
const seedAndResolve = async (
  homeDir: string,
  options: SeedAndResolveOptions,
): Promise<{ envelope: JsonEnvelope; home: ReturnType<typeof resolveHome> }> => {
  const { ctx, stdout } = testContext();
  Object.assign(ctx.env, { REFS_HOME: homeDir, ...options.envExtra });
  const home = resolveHome(ctx.env);
  await seedConfig(home, options.refs);
  await run(ctx, ['node', 'refs', 'resolve', options.query, '--json']);
  return { envelope: parseSoleEnvelope(stdout), home };
};

describe('refs resolve: file:// url resolves when REFS_ALLOW_FILE_URLS is set (step 1)', () => {
  it('threads allowFileUrls through so a local/... ref resolves by its file:// url', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const fileUrl = `file://${homeDir}/local-repos/widget`;
        const { key } = canonicalizeGitUrl(fileUrl, { allowFileUrls: true });
        const { envelope } = await seedAndResolve(homeDir, {
          envExtra: { REFS_ALLOW_FILE_URLS: '1' },
          query: fileUrl,
          refs: { [key]: OTHER_ENTRY },
        });

        expect(envelope.ok).toBe(true);
        expect((envelope.data as { key: string }).key).toBe(key);
      }),
    );
  });
});

describe('refs resolve: url-looking query fails closed rather than falling through (step 1)', () => {
  it('never echoes an embedded credential into the envelope', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: 'https://user:secret@github.com/org/repo',
          refs: { [OTHER_KEY]: OTHER_ENTRY },
        });

        expect(envelope.error?.code).toBe('validation');
        expect(JSON.stringify(envelope)).not.toContain('secret');
      }),
    );
  });

  it('hard-fails a malformed url rather than falling through to steps 2-4', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: 'https://github.com/only-owner',
          refs: { [OTHER_KEY]: OTHER_ENTRY },
        });

        expect(envelope.error?.code).toBe('validation');
      }),
    );
  });

  // Regression for the credential-echo hardening: an scp-style `git@host:path` query with a
  // secret-looking tail also fails closed, and the CORE canonicalizer's own message (which
  // interpolates the raw input verbatim in several branches) must never be rethrown as-is —
  // resolve must replace it with its own generic, non-interpolating message.
  it('never echoes a secret-looking tail on an scp-style url', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: 'git@github.com:org/repo:hunter2',
          refs: { [OTHER_KEY]: OTHER_ENTRY },
        });

        expect(envelope.error?.code).toBe('validation');
        expect(JSON.stringify(envelope)).not.toContain('hunter2');
      }),
    );
  });
});

describe('refs resolve: only a leading scheme counts as url-looking (step 1 vs step 3)', () => {
  it('routes "@scope/pkg/https://weird" to the package via prefix matching, not step-1 url failure', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: '@scope/pkg/https://weird',
          refs: { [OTHER_KEY]: SCOPED_PKG_ENTRY },
        });

        expect(envelope.ok).toBe(true);
        const data = envelope.data as { key: string; package: { name: string } | null };
        expect(data.key).toBe(OTHER_KEY);
        expect(data.package?.name).toBe('@scope/pkg');
      }),
    );
  });
});

describe('refs resolve: duplicate package name across refs is an ambiguity (steps 2/3)', () => {
  const [keyA, keyB] = SHARED_PKG_KEYS;

  it('exits usage listing every colliding ref key', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: 'shared-pkg',
          refs: { [keyA]: SHARED_PKG_ENTRY_A, [keyB]: SHARED_PKG_ENTRY_B },
        });

        expect(envelope.error?.code).toBe('usage');
        const presentKeys = SHARED_PKG_KEYS.filter((key) => messageOf(envelope).includes(key));
        expect(presentKeys).toHaveLength(SHARED_PKG_KEYS.length);
      }),
    );
  });

  it('still resolves normally when the package name is unique', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: 'shared-pkg',
          refs: { [keyA]: SHARED_PKG_ENTRY_A },
        });

        expect(envelope.ok).toBe(true);
        expect((envelope.data as { key: string }).key).toBe(keyA);
      }),
    );
  });
});

describe('refs resolve: segment-boundary traps never match a shorter package name (step 3)', () => {
  it('routes "next-auth/react" to next-auth, not next', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: 'next-auth/react',
          refs: { [NEXT_KEY]: NEXT_ENTRY, 'github.com/nextauthjs/next-auth': NEXT_AUTH_ENTRY },
        });

        const data = envelope.data as { key: string; package: { name: string } | null };
        expect(data.key).toBe('github.com/nextauthjs/next-auth');
        expect(data.package?.name).toBe('next-auth');
      }),
    );
  });

  it('never matches "@next/env" against "@next/envx"', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope } = await seedAndResolve(homeDir, {
          query: '@next/envx',
          refs: { [NEXT_KEY]: NEXT_ENTRY },
        });

        expect(envelope.error?.code).toBe('not_found');
      }),
    );
  });
});

describe('refs resolve: package path "." joins to the checkout dir itself', () => {
  it('normalizes local_path with no trailing "/." segment', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { envelope, home } = await seedAndResolve(homeDir, {
          query: 'widget-root',
          refs: { 'github.com/acme/widget-root': ROOT_PKG_ENTRY },
        });

        const dest = checkoutPath(home, zRefKey.parse('github.com/acme/widget-root'));
        const data = envelope.data as { package: { local_path: string } | null };
        expect(data.package?.local_path).toBe(dest);
      }),
    );
  });
});
