import { EXIT, readState } from '@kaisers-io/refs-core';
import {
  commitNewFileTo,
  expectGoodSyncedBadFailed,
  expectOriginMismatchFailed,
  headShaOf,
  runSyncJson,
  setupSyncedRef,
  setupTwoRefs,
} from '../helpers/sync-support.ts';
import { describe, expect, it } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { join } from 'node:path';
import { setCheckoutOrigin } from '../helpers/add-guards-support.ts';

// Integration suite for `refs sync`, against real `file://` git fixtures and a real `SpawnRunner`
// (never `FakeRunner` — `sync` shells out to real `git fetch`/`reset`/`clean`/`clone`). Test case
// labels (a)-(f) mirror the task brief's Step 1 list. Shared scaffolding (fixture setup, the
// `refs sync --json` runner, and the (f) assertion helper) lives in `test/helpers/sync-support.ts`.

const NO_RESULTS = 0;

describe('refs sync: updated', () => {
  it(
    '(a) an upstream commit is fetched and hard-reset onto (status updated), state advances',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, fixture, home, stdout } = await setupSyncedRef(homeDir);
          const before = await readState(home);
          const t0 = before.refs[added.key]?.last_fetched_at;

          await commitNewFileTo(fixture.dir, 'NEW.md', 'hello\n');
          const upstreamSha = await headShaOf(fixture.dir);
          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          // `structure` rides along on every successful ref; this fixture configures no packages.
          expect(result.data.results).toStrictEqual([
            { key: added.key, status: 'updated', structure: { status: 'ok' } },
          ]);
          const after = await readState(home);
          expect(after.refs[added.key]?.head_sha).toBe(upstreamSha);
          expect(after.refs[added.key]?.last_fetched_at).not.toBe(t0);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: fresh', () => {
  it(
    '(b) an immediate re-sync with no upstream change reports fresh',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);

          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          expect(result.data.results).toStrictEqual([
            { key: added.key, status: 'fresh', structure: { status: 'ok' } },
          ]);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: --stale-only', () => {
  it(
    '(c) skips a ref that was just fetched (within its sync_ttl), reporting no results',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);

          const result = await runSyncJson(ctx, stdout, {
            refKeys: [added.key],
            staleOnly: true,
          });

          expect(result.data.results).toHaveLength(NO_RESULTS);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: missing checkout', () => {
  it(
    '(d) a deleted checkout is re-cloned (status cloned)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, fixture, home, stdout } = await setupSyncedRef(homeDir);

          await rm(added.dest, { force: true, recursive: true });
          const upstreamSha = await headShaOf(fixture.dir);
          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          // A plain `file://` fixture remote never honours `--filter=blob:none` (see
          // `git/repo.ts#cloneRepo`'s documented fallback, exercised identically in
          // `add.test.ts`) — the re-clone downgrades to a full clone and reports that warning.
          expect(result.data.results).toStrictEqual([
            {
              key: added.key,
              status: 'cloned',
              structure: { status: 'ok' },
              warning:
                'server did not honour the partial-clone filter (blob:none); fell back to a full clone',
            },
          ]);
          const state = await readState(home);
          expect(state.refs[added.key]?.head_sha).toBe(upstreamSha);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: --stale-only with missing checkout', () => {
  it(
    '(g) still re-clones a FRESH ref whose checkout was deleted — missing checkout always needs work',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, fixture, home, stdout } = await setupSyncedRef(homeDir);

          // The ref is fresh (just synced by `setupSyncedRef`'s `refs add`), so TTL alone would
          // filter it out of `--stale-only` — but its checkout is gone, so it still needs work.
          await rm(added.dest, { force: true, recursive: true });
          const upstreamSha = await headShaOf(fixture.dir);
          const result = await runSyncJson(ctx, stdout, {
            refKeys: [added.key],
            staleOnly: true,
          });

          expect(result.data.results).toStrictEqual([
            {
              key: added.key,
              status: 'cloned',
              structure: { status: 'ok' },
              warning:
                'server did not honour the partial-clone filter (blob:none); fell back to a full clone',
            },
          ]);
          const state = await readState(home);
          expect(state.refs[added.key]?.head_sha).toBe(upstreamSha);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: dirty checkout', () => {
  it(
    '(e) local changes are discarded and the file reverted (status restored)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, stdout } = await setupSyncedRef(homeDir);
          const readmePath = join(added.dest, 'README.md');
          const original = await readFile(readmePath, 'utf8');

          await writeFile(readmePath, 'locally modified, should be discarded\n');
          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          expect(result.data.results).toStrictEqual([
            {
              key: added.key,
              status: 'restored',
              structure: { status: 'ok' },
              warning:
                'checkout had local changes (managed checkouts are read-only) — discarded and restored to the remote state',
            },
          ]);
          await expect(readFile(readmePath, 'utf8')).resolves.toBe(original);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: partial batch failure', () => {
  it(
    '(f) one broken ref (nonexistent upstream) among two: exit 1, the good ref still synced',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { bad, badFixture, ctx, good, home, stdout } = await setupTwoRefs(homeDir);
          const before = await readState(home);

          // Simulate a broken ref: its checkout is gone AND its upstream no longer exists, so a
          // re-clone attempt fails outright — the good ref's fixture/checkout stay untouched.
          await rm(bad.dest, { force: true, recursive: true });
          await rm(badFixture.dir, { force: true, recursive: true });
          const result = await runSyncJson(ctx, stdout, { refKeys: [good.key, bad.key] });

          expect(process.exitCode).toBe(EXIT.UNEXPECTED);
          await expectGoodSyncedBadFailed(result, {
            badKey: bad.key,
            goodHeadShaBefore: before.refs[good.key]?.head_sha,
            goodKey: good.key,
            goodLastFetchedBefore: before.refs[good.key]?.last_fetched_at,
            home,
          });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: origin identity', () => {
  it(
    'a checkout whose origin was repointed to another repo fails that ref only, sibling still syncs',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { bad, ctx, good, home, stdout } = await setupTwoRefs(homeDir);

          // `good`'s checkout is repointed at `bad`'s fixture — a different repo identity than
          // its configured `url` — simulating a managed checkout whose origin drifted after
          // `refs add` (e.g. hand-edited, or swapped out on disk).
          await setCheckoutOrigin(good.dest, bad.entry.url);
          const result = await runSyncJson(ctx, stdout, { refKeys: [good.key, bad.key] });

          expect(process.exitCode).toBe(EXIT.UNEXPECTED);
          await expectOriginMismatchFailed(result, {
            badKey: bad.key,
            goodDest: good.dest,
            goodKey: good.key,
            home,
          });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
