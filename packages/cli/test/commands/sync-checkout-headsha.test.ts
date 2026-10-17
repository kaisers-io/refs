import type { FakeRunner, RefEntry, RefsHome } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { checkoutPath, readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { initHome, withTempHome } from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import type { RefSyncContext } from '../../src/commands/sync-checkout.ts';
import { mkdir } from 'node:fs/promises';
import { syncCheckout } from '../../src/commands/sync-checkout.ts';
import { testContext } from '../helpers/context.ts';

// `syncExistingCheckout` re-validates the post-sync `HEAD` sha against `zRefState`'s exact shape
// before `sync-state.ts` ever persists it — `syncRef`'s `newSha` comes from a plain
// `git rev-parse HEAD`, so a checkout that ends up on a SHA-256 (64-char) HEAD would otherwise
// flow a value into state that `zState` rejects on every later read. Scripted via `FakeRunner`:
// the repo-level pipeline is real-git-tested elsewhere; what's under test here is exactly the
// guard between that pipeline's output and persistence.

const REF_KEY = zRefKey.parse('example.com/acme/widget');
const REF_URL = 'https://example.com/acme/widget.git';
const SHA1_LENGTH = 40;
const SHA256_LENGTH = 64;
const OLD_SHA = 'a'.repeat(SHA1_LENGTH);
const SHA256_HEAD = 'c'.repeat(SHA256_LENGTH);

const REF_ENTRY: RefEntry = {
  default_branch: 'main',
  description: 'A fixture ref.',
  tag_format: 'v{version}',
  url: REF_URL,
};

// The two identity guards `syncExistingCheckout` runs before `syncRef` (cli-level
// `ensureManagedCheckout`, then `ensureCheckoutOrigin`).
const scriptIdentityGuards = (runner: FakeRunner, hooksDir: string): void => {
  runner.expect('git config --local core.hooksPath', { stdout: `${hooksDir}\n` });
  runner.expect('git remote get-url origin', { stdout: `${REF_URL}\n` });
};

// `syncRef`'s full command sequence for a clean, rename-free sync whose final
// `git rev-parse HEAD` lands on `finalSha`.
const scriptSyncRefUntilHead = (runner: FakeRunner, hooksDir: string, finalSha: string): void => {
  runner.expect('git config --local --get core.hooksPath', { stdout: `${hooksDir}\n` });
  runner.expect('git rev-parse HEAD', { stdout: `${OLD_SHA}\n` });
  runner.expect('git fetch --prune --tags origin', {});
  runner.expect('git remote set-head origin --auto', {});
  runner.expect('git symbolic-ref --short refs/remotes/origin/HEAD', { stdout: 'origin/main\n' });
  runner.expect('git status --porcelain', { stdout: '' });
  runner.expect('git checkout -B main origin/main', {});
  runner.expect('git reset --hard origin/main', {});
  runner.expect('git rev-parse HEAD', { stdout: `${finalSha}\n` });
};

type SyncFixture = {
  ctx: CliContext;
  rsc: RefSyncContext;
};

/** Initialized temp home with a real (empty) checkout dir at the ref's derived path, so
 * `isGitCheckout` routes `syncCheckout` onto the existing-checkout branch — every git command is
 * then scripted, never real. */
const setupExistingCheckout = async (homeDir: string): Promise<SyncFixture> => {
  const { ctx, runner } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await initHome(ctx);
  const home: RefsHome = resolveHome(ctx.env);
  const dest = checkoutPath(home, REF_KEY);
  await mkdir(`${dest}/.git`, { recursive: true });
  const { settings } = await readConfig(home);
  scriptIdentityGuards(runner, home.hooksDir);
  scriptSyncRefUntilHead(runner, home.hooksDir, SHA256_HEAD);
  return { ctx, rsc: { home, key: REF_KEY, ref: REF_ENTRY, settings } };
};

describe('refs sync: post-sync head-sha shape guard', () => {
  it('rejects a sync that lands on a 64-char (sha256) HEAD before anything is persisted', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx, rsc } = await setupExistingCheckout(homeDir);
      await expect(syncCheckout(ctx, rsc)).rejects.toThrow(
        /refs cannot store yet \(64 hex chars\)/u,
      );
    });
  });
});
