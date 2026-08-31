import { describe, expect, it } from 'vitest';
import { gitFor, runSyncJson, setupSyncedRef } from '../helpers/sync-support.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { readConfig } from '@kaisers-io/refs-core';
import { rm } from 'node:fs/promises';

// End-to-end coverage of an upstream default-branch rename, for BOTH per-ref pipelines in
// `sync-checkout.ts`: the existing-checkout path (`syncRef` re-detects `origin/HEAD` after the
// fetch) and the missing-checkout re-clone path (`detectDefaultBranch` after a fresh clone). In
// both cases the rename must surface as a result warning AND be persisted onto the configured
// ref's `default_branch` (`sync-state.ts#applySyncSuccess`) — a rename that syncs fine but never
// lands in config would re-warn on every later sync. Kept in its own file — `sync.test.ts` has no
// headroom left under the repo's 300-line oxlint cap.

const RENAME_WARNING = 'default branch renamed to trunk';

describe('refs sync: upstream default-branch rename (existing checkout)', () => {
  it(
    'reports the rename as a warning and persists the new default branch',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, fixture, home, stdout } = await setupSyncedRef(homeDir);
          await gitFor(fixture.dir, ['branch', '-m', 'main', 'trunk']);

          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          const item = result.data.results.find((entry) => entry.key === added.key);
          expect(item?.status).toBe('fresh');
          expect(item?.warning).toBe(RENAME_WARNING);
          const config = await readConfig(home);
          expect(config.refs[added.key]?.default_branch).toBe('trunk');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs sync: upstream default-branch rename (missing checkout)', () => {
  it(
    'detects the rename on the re-clone path and persists it too',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { added, ctx, fixture, home, stdout } = await setupSyncedRef(homeDir);
          await gitFor(fixture.dir, ['branch', '-m', 'main', 'trunk']);
          await rm(added.dest, { force: true, recursive: true });

          const result = await runSyncJson(ctx, stdout, { refKeys: [added.key] });

          const item = result.data.results.find((entry) => entry.key === added.key);
          expect(item?.status).toBe('cloned');
          // The `file://` fixture also downgrades the default blobless clone to full — both
          // warnings must survive side by side (`sync-core.ts#buildWarning`'s merge), the rename
          // never swallowed by the clone-mode fallback or vice versa.
          expect(item?.warning).toContain(RENAME_WARNING);
          expect(item?.warning).toContain('fell back to a full clone');
          const config = await readConfig(home);
          expect(config.refs[added.key]?.default_branch).toBe('trunk');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
