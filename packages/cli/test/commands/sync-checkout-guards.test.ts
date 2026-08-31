import { describe, expect, it } from 'vitest';
import { plantSymlinkedAncestor, relocateBehindSymlink } from '../helpers/add-guards-support.ts';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { runSyncJson, setupSyncedRef } from '../helpers/sync-support.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { EXIT } from '@kaisers-io/refs-core';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { join } from 'node:path';

// Final-review finding (round 1): `syncMissingCheckout`'s re-clone path (`sync-checkout.ts`) used
// to `mkdir(dirname(dest), { recursive: true })` + `cloneRepo` without ever containment-checking
// `dest` against `home.sourcesDir` first. Round 2: the EXISTING-checkout branch had the same gap —
// `isGitCheckout(dest)`'s existsSync follows symlinked ancestors, so a checkout that physically
// lives outside `sources/` behind such a symlink would be hard-reset/cleaned (`syncRef`) out
// there, bypassing the guard entirely; the containment check is therefore hoisted to
// `syncCheckout`'s dispatch level, covering BOTH branches. Real-fs symlinks honestly reproduce
// both exploit shapes: the file-fixture `local` host segment is replaced by a symlink pointing
// outside the managed tree. Kept in its own file — neither `sync.test.ts` nor `sync-support.ts`
// has headroom left under the repo's 300-line oxlint cap.

const NO_ENTRIES: readonly string[] = [];
const DIRTY_CONTENT = 'untracked local file that a hard reset/clean would sweep away\n';
const HOST_SEGMENTS = 1;

describe('refs sync: containment guard on re-clone', () => {
  it(
    'fails closed (no clone) when an ancestor path segment under sources/ is a symlink pointing outside the tree',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, home, stdout } = await setupSyncedRef(homeDir);
          const outside = await plantSymlinkedAncestor(join(home.sourcesDir, 'local'));

          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          expect(process.exitCode).toBe(EXIT.UNEXPECTED);
          const item = result.data.results.find((entry) => entry.key === added.key);
          expect(item?.status).toBe('failed');
          expect(item?.error).toMatch(/containment/u);
          await expect(readdir(outside)).resolves.toStrictEqual([...NO_ENTRIES]);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: containment guard on existing checkout', () => {
  it(
    'fails closed without mutating an outside checkout reached via a symlinked ancestor',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // The relocated checkout is the ref's own managed clone (matching origin AND hooksPath
          // marker), so without a dispatch-level containment check `syncExistingCheckout` would
          // pass both identity guards and `syncRef` would hard-reset/clean it outside sources/ —
          // sweeping away the untracked file planted below.
          const { added, ctx, home, stdout } = await setupSyncedRef(homeDir);
          const relocated = await relocateBehindSymlink(join(home.sourcesDir, 'local'));
          const dirtyPath = join(
            relocated,
            ...added.key.split('/').slice(HOST_SEGMENTS),
            'DIRTY.txt',
          );
          await writeFile(dirtyPath, DIRTY_CONTENT);

          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          expect(process.exitCode).toBe(EXIT.UNEXPECTED);
          const item = result.data.results.find((entry) => entry.key === added.key);
          expect(item?.status).toBe('failed');
          expect(item?.error).toMatch(/containment/u);
          await expect(readFile(dirtyPath, 'utf8')).resolves.toBe(DIRTY_CONTENT);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
