import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  markCheckoutPresent,
  minutesAgoIso,
  seedConfig,
  seedState,
} from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// `refs resolve`'s stale/missing flags reuse exactly the same `isStale`/`isGitCheckout` logic as
// `refs list` (see `list.test.ts`'s equivalent cases) — split into its own file purely to keep
// `resolve.test.ts` under the repo's 300-line oxlint cap.

const OTHER_KEY = 'github.com/acme/other';
const NEXT_KEY = 'github.com/vercel/next.js';
const FRESH_MINUTES_AGO = 1;
const STALE_MINUTES_AGO = 90;

const OTHER_ENTRY = {
  default_branch: 'main',
  description: 'Some other ref',
  tag_format: 'v{version}',
  url: 'https://github.com/acme/other',
};

const NEXT_ENTRY = {
  default_branch: 'canary',
  description: 'Next.js monorepo',
  packages: { next: { description: 'the framework', path: 'packages/next' } },
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};

type ResolveDataShape = {
  missing: boolean;
  stale: boolean;
};

const parseSoleEnvelope = (stdout: readonly string[]): { data: ResolveDataShape } => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as { data: ResolveDataShape };
};

describe('refs resolve: stale (never fetched) and missing (no checkout)', () => {
  it('is stale and missing for an unfetched, uncloned ref', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [OTHER_KEY]: OTHER_ENTRY });

        await run(ctx, ['node', 'refs', 'resolve', 'other', '--json']);

        const { data } = parseSoleEnvelope(stdout);
        expect(data.stale).toBe(true);
        expect(data.missing).toBe(true);
      }),
    );
  });
});

describe('refs resolve: fresh (recently fetched) and present (checkout exists)', () => {
  it('is fresh and present for a recently fetched, checked-out ref', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXT_KEY]: NEXT_ENTRY });
        await seedState(home, {
          [NEXT_KEY]: { last_fetched_at: minutesAgoIso(FRESH_MINUTES_AGO) },
        });
        await markCheckoutPresent(checkoutPath(home, zRefKey.parse(NEXT_KEY)));

        await run(ctx, ['node', 'refs', 'resolve', 'next', '--json']);

        const { data } = parseSoleEnvelope(stdout);
        expect(data.stale).toBe(false);
        expect(data.missing).toBe(false);
      }),
    );
  });
});

describe('refs resolve: stale once last_fetched_at is older than the resolved sync_ttl', () => {
  it('is stale', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [OTHER_KEY]: { ...OTHER_ENTRY, sync_ttl: '30m' } });
        await seedState(home, {
          [OTHER_KEY]: { last_fetched_at: minutesAgoIso(STALE_MINUTES_AGO) },
        });

        await run(ctx, ['node', 'refs', 'resolve', 'other', '--json']);

        const { data } = parseSoleEnvelope(stdout);
        expect(data.stale).toBe(true);
      }),
    );
  });
});
