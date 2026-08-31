import { EXIT, readState } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { runSyncJson, setupSyncedRef } from '../helpers/sync-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { run } from '../../src/main.ts';

// `refs sync`'s argument handling: an unmatched `[refs…]` argument, and the empty configuration.
// Split out of `sync.test.ts` purely to keep that file under the repo's 300-line oxlint cap; both
// cases are about what `sync` does BEFORE any git work, so they share nothing with the per-ref
// pipeline cases that stayed behind.

const NO_RESULTS = 0;

describe('refs sync: unknown ref argument', () => {
  it(
    'an unmatched [refs…] argument fails fast (no partial batch run)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, home, stdout } = await setupSyncedRef(homeDir);
          const before = await readState(home);

          await run(ctx, ['node', 'refs', 'sync', 'definitely-not-a-ref', '--json']);

          expect(process.exitCode).toBe(EXIT.NOT_FOUND);
          const envelope = parseLastEnvelope(stdout) as { error?: { code: string }; ok: boolean };
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('not_found');
          const after = await readState(home);
          expect(after.refs[added.key]?.last_fetched_at).toBe(
            before.refs[added.key]?.last_fetched_at,
          );
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: no configured refs', () => {
  it('with no refs configured, syncs nothing and reports an empty result set', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = realContextFor(homeDir);
        await initHome(ctx);

        const result = await runSyncJson(ctx, stdout, { refKeys: [] });

        expect(result.ok).toBe(true);
        expect(result.data.results).toHaveLength(NO_RESULTS);
        expect(process.exitCode).not.toBe(EXIT.UNEXPECTED);
      }),
    );
  });
});
