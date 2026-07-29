import type { RefKey, RefState, RefsHome } from '@kaisers-io/refs-core';
import { applySyncSuccess, recordFailure } from '../../src/commands/sync-state.ts';
import { describe, expect, it } from 'vitest';
import { initHome, realContextFor, withTempHome } from '../helpers/add-support.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import {
  readConfig,
  readState,
  resolveHome,
  writeConfig,
  writeState,
  zRefKey,
} from '@kaisers-io/refs-core';
import type { RefSyncOutcome } from '../../src/commands/sync-checkout.ts';

// Unit coverage for `sync-state.ts`'s persistence semantics that the sync e2e suite can't reach
// cheaply: the branch-rename config write's defensive no-op (ref removed mid-run), and
// `buildSyncedState`'s carry-over rules (a success drops a stale `last_error`; the effective clone
// mode is carried from previous state only when this round didn't reclone).

const REF_KEY: RefKey = zRefKey.parse('example.com/acme/widget');
const SHA_LENGTH = 40;
const OLD_SHA = 'a'.repeat(SHA_LENGTH);
const NEW_SHA = 'b'.repeat(SHA_LENGTH);

const seedConfiguredRef = async (home: RefsHome): Promise<void> => {
  const config = await readConfig(home);
  config.refs[REF_KEY] = {
    default_branch: 'main',
    description: 'A fixture ref.',
    tag_format: 'v{version}',
    url: 'https://example.com/acme/widget.git',
  };
  await writeConfig(home, config);
};

/** Fresh initialized temp home; with `opts.configured` the fixture ref is also written to config. */
const setupHome = async (homeDir: string, opts: { configured: boolean }): Promise<RefsHome> => {
  const { ctx } = realContextFor(homeDir);
  await initHome(ctx);
  const home = resolveHome(ctx.env);
  if (opts.configured) {
    await seedConfiguredRef(home);
  }
  return home;
};

const seedState = async (home: RefsHome, entry: RefState): Promise<void> => {
  const state = await readState(home);
  state.refs[REF_KEY] = entry;
  await writeState(home, state);
};

const RENAMED_OUTCOME: RefSyncOutcome = {
  branchRenamedTo: 'trunk',
  headSha: NEW_SHA,
  status: 'fresh',
};

describe('applySyncSuccess: branch rename persistence', () => {
  it('writes the renamed default branch onto the configured ref', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = await setupHome(homeDir, { configured: true });
      await applySyncSuccess(home, REF_KEY, RENAMED_OUTCOME);
      const config = await readConfig(home);
      expect(config.refs[REF_KEY]?.default_branch).toBe('trunk');
      const state = await readState(home);
      expect(state.refs[REF_KEY]?.head_sha).toBe(NEW_SHA);
    });
  });

  it('still records state when the ref has meanwhile been removed from config', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = await setupHome(homeDir, { configured: false });
      await applySyncSuccess(home, REF_KEY, RENAMED_OUTCOME);
      const config = await readConfig(home);
      expect(config.refs[REF_KEY]).toBeUndefined();
      const state = await readState(home);
      expect(state.refs[REF_KEY]?.head_sha).toBe(NEW_SHA);
    });
  });
});

describe('applySyncSuccess: state carry-over rules', () => {
  it('drops a stale last_error and carries the previous effective clone mode forward', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = await setupHome(homeDir, { configured: true });
      await seedState(home, {
        effective_clone_mode: 'blobless',
        head_sha: OLD_SHA,
        last_error: 'previous sync failed',
      });
      await applySyncSuccess(home, REF_KEY, { headSha: NEW_SHA, status: 'updated' });
      const state = await readState(home);
      expect(state.refs[REF_KEY]).toStrictEqual({
        effective_clone_mode: 'blobless',
        head_sha: NEW_SHA,
        last_fetched_at: state.refs[REF_KEY]?.last_fetched_at,
      });
    });
  });

  it('prefers a reclone round’s own effective clone mode over the previous state', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = await setupHome(homeDir, { configured: true });
      await seedState(home, { effective_clone_mode: 'blobless', head_sha: OLD_SHA });
      await applySyncSuccess(home, REF_KEY, {
        effectiveCloneMode: 'full',
        headSha: NEW_SHA,
        status: 'cloned',
      });
      const state = await readState(home);
      expect(state.refs[REF_KEY]?.effective_clone_mode).toBe('full');
    });
  });
});

describe('record failure persistence', () => {
  it('adds last_error while preserving every other persisted field', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const home = await setupHome(homeDir, { configured: true });
      await seedState(home, { effective_clone_mode: 'full', head_sha: OLD_SHA });
      await recordFailure(home, REF_KEY, 'fetch failed: network unreachable');
      const state = await readState(home);
      expect(state.refs[REF_KEY]).toStrictEqual({
        effective_clone_mode: 'full',
        head_sha: OLD_SHA,
        last_error: 'fetch failed: network unreachable',
      });
    });
  });
});
