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

// Unit + CLI-wiring tests for `refs list` — config/state are seeded directly via `writeConfig`/
// `writeState` (never through a real `refs add`), per the task brief. `checkoutPath`/a bare `.git`
// directory (via `markCheckoutPresent`) stand in for a real clone.

const ALPHA_KEY = 'github.com/acme/alpha';
const BETA_KEY = 'github.com/acme/beta';
const FIRST_INDEX = 0;
const FRESH_MINUTES_AGO = 1;
const STALE_OFFSET_MINUTES = 40;
const FRESH_OFFSET_MINUTES = 10;
const SHORT_TTL = '30m';
const TTL_MINUTES = 30;
const BOUNDARY_MARGIN_MINUTES = 5;
const JUST_INSIDE_TTL_MINUTES = TTL_MINUTES - BOUNDARY_MARGIN_MINUTES;
const JUST_OUTSIDE_TTL_MINUTES = TTL_MINUTES + BOUNDARY_MARGIN_MINUTES;

const ALPHA_ENTRY = {
  clone_mode: 'full',
  default_branch: 'main',
  description: 'Alpha lib',
  // eslint-disable-next-line sort-keys -- reverse lexical order on purpose, so the --packages test below proves the sort, not just inclusion
  packages: {
    'zeta-pkg': { description: 'second', path: 'packages/zeta' },
    'alpha-pkg': { description: 'pkg', path: '.' },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/alpha',
};
const BETA_ENTRY = {
  default_branch: 'main',
  description: 'Beta lib',
  tag_format: 'v{version}',
  url: 'https://github.com/acme/beta',
};

type JsonEnvelope = {
  data: unknown;
  ok: boolean;
};

const parseSoleEnvelope = (stdout: readonly string[]): JsonEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as JsonEnvelope;
};

const expectListData = (envelope: JsonEnvelope, expected: unknown): void => {
  expect(envelope.ok).toBe(true);
  expect(envelope.data).toStrictEqual(expected);
};

describe('refs list: sorted data with resolved clone_mode/staleness/missing/packages_count', () => {
  it('lists alpha (fresh, present, override) before beta (stale, missing, default)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        const alphaLastFetchedAt = minutesAgoIso(FRESH_MINUTES_AGO);
        await seedConfig(home, { [BETA_KEY]: BETA_ENTRY, [ALPHA_KEY]: ALPHA_ENTRY });
        await seedState(home, { [ALPHA_KEY]: { last_fetched_at: alphaLastFetchedAt } });
        await markCheckoutPresent(checkoutPath(home, zRefKey.parse(ALPHA_KEY)));

        await run(ctx, ['node', 'refs', 'list', '--json']);

        expectListData(parseSoleEnvelope(stdout), [
          {
            clone_mode: 'full',
            description: 'Alpha lib',
            key: ALPHA_KEY,
            last_fetched_at: alphaLastFetchedAt,
            missing: false,
            packages_count: 2,
            stale: false,
          },
          {
            clone_mode: 'blobless',
            description: 'Beta lib',
            key: BETA_KEY,
            missing: true,
            packages_count: 0,
            stale: true,
          },
        ]);
      }),
    );
  });
});

// Split out of the describe above purely to keep it under the repo's max-lines-per-function cap.
describe('refs list: --packages opt-in', () => {
  it('includes the sorted package names when --packages is passed', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ALPHA_KEY]: ALPHA_ENTRY, [BETA_KEY]: BETA_ENTRY });

        await run(ctx, ['node', 'refs', 'list', '--json', '--packages']);

        expectListData(parseSoleEnvelope(stdout), [
          {
            clone_mode: 'full',
            description: 'Alpha lib',
            key: ALPHA_KEY,
            missing: true,
            packages: ['alpha-pkg', 'zeta-pkg'],
            packages_count: 2,
            stale: true,
          },
          {
            clone_mode: 'blobless',
            description: 'Beta lib',
            key: BETA_KEY,
            missing: true,
            packages: [],
            packages_count: 0,
            stale: true,
          },
        ]);
      }),
    );
  });
});

describe('refs list: staleness with no last_fetched_at at all', () => {
  it('is stale', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ALPHA_KEY]: ALPHA_ENTRY });

        await run(ctx, ['node', 'refs', 'list', '--json']);

        const envelope = parseSoleEnvelope(stdout) as { data: { stale: boolean }[] };
        expect(envelope.data[FIRST_INDEX]?.stale).toBe(true);
      }),
    );
  });
});

describe('refs list: staleness past the resolved sync_ttl', () => {
  it('is stale once last_fetched_at is older than sync_ttl', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ALPHA_KEY]: { ...ALPHA_ENTRY, sync_ttl: SHORT_TTL } });
        await seedState(home, {
          [ALPHA_KEY]: { last_fetched_at: minutesAgoIso(STALE_OFFSET_MINUTES) },
        });

        await run(ctx, ['node', 'refs', 'list', '--json']);

        const envelope = parseSoleEnvelope(stdout) as { data: { stale: boolean }[] };
        expect(envelope.data[FIRST_INDEX]?.stale).toBe(true);
      }),
    );
  });
});

describe('refs list: freshness within the resolved sync_ttl', () => {
  it('is fresh when last_fetched_at is within sync_ttl', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ALPHA_KEY]: { ...ALPHA_ENTRY, sync_ttl: SHORT_TTL } });
        await seedState(home, {
          [ALPHA_KEY]: { last_fetched_at: minutesAgoIso(FRESH_OFFSET_MINUTES) },
        });

        await run(ctx, ['node', 'refs', 'list', '--json']);

        const envelope = parseSoleEnvelope(stdout) as { data: { stale: boolean }[] };
        expect(envelope.data[FIRST_INDEX]?.stale).toBe(false);
      }),
    );
  });
});

// Documents the strict `>` (not `>=`) staleness contract: `now - last_fetched_at` exactly equal to
// `ttl` would be "not stale", but asserting exact equality here would be racy (the command itself
// calls `Date.now()` after this test computes its fixture timestamp). Instead, this asserts both
// sides of the boundary with a generous-but-tight margin around the ttl.
describe('refs list: staleness boundary uses strict > (not >=) against the ttl', () => {
  it('is fresh just inside the ttl and stale just outside it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ALPHA_KEY]: { ...ALPHA_ENTRY, sync_ttl: SHORT_TTL } });
        await seedState(home, {
          [ALPHA_KEY]: { last_fetched_at: minutesAgoIso(JUST_INSIDE_TTL_MINUTES) },
        });

        await run(ctx, ['node', 'refs', 'list', '--json']);

        const envelope = parseSoleEnvelope(stdout) as { data: { stale: boolean }[] };
        expect(envelope.data[FIRST_INDEX]?.stale).toBe(false);
      }),
    );
  });

  it('is stale just outside the ttl', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ALPHA_KEY]: { ...ALPHA_ENTRY, sync_ttl: SHORT_TTL } });
        await seedState(home, {
          [ALPHA_KEY]: { last_fetched_at: minutesAgoIso(JUST_OUTSIDE_TTL_MINUTES) },
        });

        await run(ctx, ['node', 'refs', 'list', '--json']);

        const envelope = parseSoleEnvelope(stdout) as { data: { stale: boolean }[] };
        expect(envelope.data[FIRST_INDEX]?.stale).toBe(true);
      }),
    );
  });
});

describe('refs list: human mode status/missing lines', () => {
  it('appends status: stale and missing: lines for a stale, missing ref', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [BETA_KEY]: BETA_ENTRY });

        await run(ctx, ['node', 'refs', 'list']);

        expect(stdout).toStrictEqual([
          `ref: ${BETA_KEY}`,
          'description: Beta lib',
          'synced: never',
          'missing: checkout not found — run: refs sync',
        ]);
      }),
    );
  });
});

describe('refs list: human mode with no status/missing lines', () => {
  it('prints just ref/description/synced for a fresh, present ref', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ALPHA_KEY]: ALPHA_ENTRY });
        await seedState(home, {
          [ALPHA_KEY]: { last_fetched_at: minutesAgoIso(FRESH_MINUTES_AGO) },
        });
        await markCheckoutPresent(checkoutPath(home, zRefKey.parse(ALPHA_KEY)));

        await run(ctx, ['node', 'refs', 'list']);

        expect(stdout).toStrictEqual([
          `ref: ${ALPHA_KEY}`,
          'description: Alpha lib',
          'synced: 1 minute ago',
        ]);
      }),
    );
  });
});
