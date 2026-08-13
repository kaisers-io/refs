import { describe, expect, it } from 'vitest';
import { runSyncJson, setupSyncedRef } from '../helpers/sync-support.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { Fetcher } from '@kaisers-io/refs-core';

// `refs sync` is the one routine command that mentions a newer published CLI. It is the right place
// precisely because it is already network-bound and TTL-gated: `INVESTIGATE.md` has the agent sync
// whenever a ref is stale, so the notice reaches normal use without any command going to the
// registry on its own account.
//
// The notice rides the existing `warnings` array. That keeps `data` — the per-ref results a caller
// parses — exactly as it was.
const TEST_TIMEOUT_MS = 30_000;

const respondingWith =
  (version: string): Fetcher =>
  () =>
    Promise.resolve({ json: () => Promise.resolve({ version }), status: 200 });

describe('refs sync: update notice', () => {
  it(
    'warns once when the registry reports a newer version',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);
          ctx.cliVersion = '0.8.3';
          ctx.fetcher = respondingWith('0.9.0');

          const first = await runSyncJson(ctx, stdout, { refKeys: [added.key] });
          // Second run inside the 24h TTL: the cache answers, so nothing was refreshed and nothing
          // is announced. This is the whole throttle — no record of "already told you" is kept.
          const second = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          expect(first.warnings).toStrictEqual([
            'refs 0.9.0 is available (this is 0.8.3) — update: npm i -g @kaisers-io/refs@latest',
          ]);
          expect(second.warnings).toStrictEqual([]);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs sync: when there is nothing to announce', () => {
  it(
    'says nothing when this CLI is current, and nothing when the registry is unreachable',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);
          ctx.cliVersion = '0.9.0';
          ctx.fetcher = respondingWith('0.9.0');

          const current = await runSyncJson(ctx, stdout, { refKeys: [added.key] });
          ctx.fetcher = () => Promise.reject(new Error('offline'));
          const offline = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          expect(current.warnings).toStrictEqual([]);
          // A registry it could not reach is not a fact about the refs this command reports on.
          expect(offline.warnings).toStrictEqual([]);
          expect(offline.ok).toBe(true);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stays silent when notifications are switched off, and still syncs',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);
          ctx.cliVersion = '0.8.3';
          ctx.fetcher = respondingWith('0.9.0');
          ctx.env['REFS_UPDATE_CHECK'] = '0';

          const envelope = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          expect(envelope.warnings).toStrictEqual([]);
          expect(envelope.data.results).toHaveLength(1);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
