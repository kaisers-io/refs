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

// A sync failure's message is not bounded by anything this side cares about: most of it is git's
// own stderr, and git quotes every ref it was working on. `SpawnRunner`'s 64 MiB stream cap stops a
// runaway subprocess; it is no budget for a string written into `state.json` and read back on every
// later command. Reproduced against a real remote: 120 conflicting tags produced 47,816 characters.
//
// The numbers below are deliberately NOT derived from the production constant. A test that sizes
// its input from the cap it is checking moves with the cap, and every assertion stays green however
// large the cap becomes.
const HUGE_MESSAGE_CHARS = 100_000;
const PERSISTED_CEILING_CHARS = 4000;
const PREFIX = 'git fetch failed: ';
const SUFFIX = " try running 'git remote prune origin'";

/** A message of exactly `length` characters that begins with `PREFIX` and ends with `SUFFIX`, so a
 * test can tell which end of it survived. */
const messageOf = (length: number): string => {
  const filler = 'x'.repeat(length - PREFIX.length - SUFFIX.length);
  return `${PREFIX}${filler}${SUFFIX}`;
};

/** Records `message` against a fresh home and reads back what was persisted — the whole of every
 * case below, so each test body is its message and its assertions. The `??` lives here rather than
 * in a test, where `vitest/no-conditional-in-test` would refuse it. */
const recordAndReadBack = async (message: string): Promise<string> => {
  let recorded = '';
  await withTempHome(async (homeDir) => {
    const { ctx } = realContextFor(homeDir);
    await initHome(ctx);
    const home = resolveHome(ctx.env);
    const key = zRefKey.parse('github.com/acme/widget');
    await recordFailure(home, key, message);
    const state = await readState(home);
    recorded = state.refs[key]?.last_error ?? '';
  });
  return recorded;
};

const NOTICE_PATTERN = /\n… (?<count>\d+) characters omitted …\n/u;

/** The truncation notice as written, or `''` when there is none — hoisted out of the test body,
 * where `vitest/no-conditional-in-test` refuses the `??`. */
const noticeIn = (recorded: string): string => NOTICE_PATTERN.exec(recorded)?.[0] ?? '';

/** The count the truncation notice claims, or `undefined` when there is no notice. */
const omittedCountIn = (recorded: string): number | undefined => {
  const match = NOTICE_PATTERN.exec(recorded);
  return match?.groups?.['count'] === undefined ? undefined : Number(match.groups['count']);
};

describe('a failure message large enough to matter', () => {
  it('persists a bounded amount of it, however much arrives', async () => {
    expect.hasAssertions();

    const recorded = await recordAndReadBack(messageOf(HUGE_MESSAGE_CHARS));

    expect(recorded.length).toBeLessThan(PERSISTED_CEILING_CHARS);
  });

  it('keeps both ends — the command at the top, git’s own hint at the bottom', async () => {
    expect.hasAssertions();

    const recorded = await recordAndReadBack(messageOf(HUGE_MESSAGE_CHARS));

    expect(recorded.startsWith(PREFIX)).toBe(true);
    expect(recorded.endsWith(SUFFIX)).toBe(true);
  });

  it('states exactly how much it dropped', async () => {
    expect.hasAssertions();
    const message = messageOf(HUGE_MESSAGE_CHARS);

    const recorded = await recordAndReadBack(message);

    // Derived from what was actually persisted rather than from the cap, so the notice cannot
    // drift from the truncation it describes: a plausible-looking but wrong count is the failure
    // this pins. `recorded.length - notice.length` is how much of the original survived.
    const survived = recorded.length - noticeIn(recorded).length;
    expect(omittedCountIn(recorded)).toBe(message.length - survived);
  });

  it('leaves an ordinary failure message exactly as it arrived', async () => {
    expect.hasAssertions();
    const ordinary = "git fetch failed: error: 'refs/tags/release' exists; cannot create …";

    const recorded = await recordAndReadBack(ordinary);

    expect(recorded).toBe(ordinary);
    expect(omittedCountIn(recorded)).toBeUndefined();
  });
});
