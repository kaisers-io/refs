import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { rm } from 'node:fs/promises';
import { run } from '../../src/main.ts';
import { setupSyncedRef } from '../helpers/sync-support.ts';

// `--sync-if-stale` against a real fixture repository, because the thing worth proving is that the
// answer describes the checkout AFTER the sync.
//
// The skill used to mandate resolve → sync → resolve AGAIN, and the third call was not ceremony:
// verification had described the checkout as it was BEFORE the sync, so reusing that answer meant
// reporting a path that no longer necessarily held what it claimed. That correctness now lives in
// the code instead of in a rule the model has to remember, which is the entire point of the flag.

const LAST = -1;

type JsonEnvelope = { data: Record<string, unknown>; ok: boolean };

const lastEnvelope = (stdout: readonly string[]): JsonEnvelope => {
  const line = stdout.at(LAST);
  if (line === undefined) {
    throw new Error('expected a json envelope line, got none');
  }
  return JSON.parse(line) as JsonEnvelope;
};

describe('refs resolve --sync-if-stale on a checkout that is gone', () => {
  it(
    're-clones and answers about the checkout that now exists, in one call',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);
          // The case the old three-call sequence existed for: nothing is there to describe until
          // something fetches it.
          await rm(added.dest, { force: true, recursive: true });

          await run(ctx, ['node', 'refs', 'resolve', added.key, '--sync-if-stale', '--json']);
          const envelope = lastEnvelope(stdout);

          expect(envelope.ok).toBe(true);
          expect(envelope.data['sync']).toStrictEqual({ status: 'cloned' });
          // Post-sync, not pre-sync: the checkout was absent when the call started.
          expect(envelope.data['missing']).toBe(false);
          expect(envelope.data['checkout']).toStrictEqual({ status: 'managed' });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs resolve --sync-if-stale on a fresh ref', () => {
  it(
    'does not sync, and reports no sync having happened',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);

          await run(ctx, ['node', 'refs', 'resolve', added.key, '--sync-if-stale', '--json']);
          const envelope = lastEnvelope(stdout);

          // The flag is opt-in permission to fetch, not an instruction to. A ref inside its
          // `sync_ttl` needs nothing, and the fast path has to stay fast.
          expect(envelope.data['sync']).toBeUndefined();
          expect(envelope.data['stale']).toBe(false);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
