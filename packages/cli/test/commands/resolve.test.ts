import { EXIT, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  markCheckoutPresent,
  minutesAgoIso,
  seedConfig,
  seedState,
} from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// Unit + CLI-wiring tests for `refs resolve` — the deterministic agent-routing command. Config is
// seeded directly via `writeConfig`/`writeState` (via the shared `ref-fixtures.ts` helpers), never
// through a real `refs add`, per the task brief. No git needed: `resolve` is pure config/state/path
// logic, with missing/stale flags driven purely by written state and (absent) checkout dirs — see
// `resolve-status.test.ts` for that part specifically.

const NEXT_KEY = 'github.com/vercel/next.js';
const FRESH_MINUTES_AGO = 1;

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

const WIDGET_ENTRY = {
  default_branch: 'main',
  description: 'A widget ref',
  tag_format: 'v{version}',
  url: 'https://example.com/widget',
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

type ResolveDataShape = {
  key: string;
  last_fetched_at?: string;
  local_path: string;
  missing: boolean;
  package: { local_path: string; name: string; path: string } | null;
  stale: boolean;
};

/** Seeds the shared next.js monorepo fixture (two packages, fresh state, a present checkout) and
 * returns its resolved checkout path and `last_fetched_at` — the common starting point for steps
 * 1-4's happy paths. */
const seedNextFixture = async (
  env: CliContext['env'],
): Promise<{ dest: string; lastFetchedAt: string }> => {
  const home = resolveHome(env);
  const lastFetchedAt = minutesAgoIso(FRESH_MINUTES_AGO);
  await seedConfig(home, { [NEXT_KEY]: NEXT_ENTRY });
  await seedState(home, { [NEXT_KEY]: { last_fetched_at: lastFetchedAt } });
  const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
  await markCheckoutPresent(dest);
  return { dest, lastFetchedAt };
};

describe('refs resolve: exact npm package name (step 2)', () => {
  it('resolves "next" to the next package with a joined local_path', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const { dest, lastFetchedAt } = await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', 'next', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(true);
        expect(envelope.data).toStrictEqual({
          key: NEXT_KEY,
          last_fetched_at: lastFetchedAt,
          local_path: dest,
          missing: false,
          package: {
            // `join`, not `/`-concatenation: the product emits a real, platform-native fs path.
            local_path: join(dest, 'packages', 'next'),
            name: 'next',
            path: 'packages/next',
          },
          stale: false,
        });
      }),
    );
  });
});

describe('refs resolve: import-path prefix on segment boundaries (step 3, unscoped)', () => {
  it('resolves "next/navigation" to the next package', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', 'next/navigation', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        const data = envelope.data as ResolveDataShape;
        expect(data.key).toBe(NEXT_KEY);
        expect(data.package?.name).toBe('next');
        expect(data.package?.path).toBe('packages/next');
      }),
    );
  });
});

describe('refs resolve: import-path prefix on segment boundaries (step 3, scoped)', () => {
  it('resolves "@next/env/x" to the @next/env package', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', '@next/env/x', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        const data = envelope.data as ResolveDataShape;
        expect(data.key).toBe(NEXT_KEY);
        expect(data.package?.name).toBe('@next/env');
        expect(data.package?.path).toBe('packages/next-env');
      }),
    );
  });
});

describe('refs resolve: a configured git url resolves to a key match (step 1)', () => {
  it('resolves the url to its key, package: null', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', 'https://github.com/vercel/next.js', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        const data = envelope.data as ResolveDataShape;
        expect(data.key).toBe(NEXT_KEY);
        expect(data.package).toBeNull();
      }),
    );
  });
});

describe('refs resolve: a syntactically valid but unconfigured git url (step 1)', () => {
  it('is a not-found, not a fall-through to steps 2-4', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', 'https://github.com/acme/unknown', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe('not_found');
        expect(process.exitCode).toBe(EXIT.NOT_FOUND);
      }),
    );
  });
});

describe('refs resolve: ref-key suffix match (step 4)', () => {
  it('resolves the "next.js" suffix to the full key, package: null', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', 'next.js', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        const data = envelope.data as ResolveDataShape;
        expect(data.key).toBe(NEXT_KEY);
        expect(data.package).toBeNull();
      }),
    );
  });
});

describe('refs resolve: no match at all', () => {
  it('exits not_found with the resolve not-found envelope', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', 'totally-unknown-thing', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe('not_found');
        expect(envelope.error?.message).toBe(
          "no ref matches 'totally-unknown-thing' — run refs list, or add it: refs add <url>",
        );
        expect(process.exitCode).toBe(EXIT.NOT_FOUND);
      }),
    );
  });
});

describe('refs resolve: ambiguous suffix passes matchRefKey usageError through unchanged', () => {
  it('exits usage rather than not_found for an ambiguous suffix', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, {
          'github.com/acme/widget': WIDGET_ENTRY,
          'gitlab.com/acme/widget': WIDGET_ENTRY,
        });

        await run(ctx, ['node', 'refs', 'resolve', 'widget', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe('usage');
        expect(process.exitCode).toBe(EXIT.USAGE);
      }),
    );
  });
});

describe('refs resolve: human mode', () => {
  // Key/value convention mirroring `show.ts`'s `showHuman` (`ref:`/`path:`/`synced:`), rather
  // than the bare-key + `local_path:` pairing this command used before.
  it('prints ref/path/synced/package/package path lines', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const { dest } = await seedNextFixture(ctx.env);

        await run(ctx, ['node', 'refs', 'resolve', 'next']);

        expect(stdout).toStrictEqual([
          `ref: ${NEXT_KEY}`,
          `path: ${dest}`,
          'synced: 1 minute ago',
          'package: next',
          `package path: ${join(dest, 'packages', 'next')}`,
        ]);
      }),
    );
  });
});
