import type { FakeRunner, RefEntry } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { checkoutPath, readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { initHome, withTempHome } from '../helpers/add-support.ts';
import { mkdir } from 'node:fs/promises';
import { syncCheckout } from '../../src/commands/sync-checkout.ts';
import { testContext } from '../helpers/context.ts';

// `REFS_NETWORK_TIMEOUT` reaches exactly the commands that talk to the remote — fetch and
// `remote set-head --auto` — and nothing that only reads the checkout.

const REF_KEY = zRefKey.parse('example.com/acme/widget');
const REF_URL = 'https://example.com/acme/widget.git';
const SHA1_LENGTH = 40;
const SHA = 'a'.repeat(SHA1_LENGTH);
const DEADLINE_SECONDS = 30;
const DEADLINE_MS = 30_000;
const REF_ENTRY: RefEntry = { default_branch: 'main', description: 'A fixture ref.', url: REF_URL };

const scriptGuards = (runner: FakeRunner, hooksDir: string): void => {
  runner.expect('git config --local core.hooksPath', { stdout: `${hooksDir}\n` });
  runner.expect('git remote get-url origin', { stdout: `${REF_URL}\n` });
  runner.expect('git config --local --get core.hooksPath', { stdout: `${hooksDir}\n` });
  runner.expect('git rev-parse HEAD', { stdout: `${SHA}\n` });
};

const scriptFetchAndReset = (runner: FakeRunner): void => {
  runner.expect('git fetch --prune --tags origin', {});
  runner.expect('git remote set-head origin --auto', {});
  runner.expect('git symbolic-ref --short refs/remotes/origin/HEAD', { stdout: 'origin/main\n' });
  runner.expect('git status --porcelain', { stdout: '' });
  runner.expect('git checkout -B main origin/main', {});
  runner.expect('git reset --hard origin/main', {});
  runner.expect('git rev-parse HEAD', { stdout: `${SHA}\n` });
};

const scriptAll = (runner: FakeRunner, hooksDir: string): void => {
  scriptGuards(runner, hooksDir);
  scriptFetchAndReset(runner);
};

/** Syncs an existing (scripted) checkout and returns each command with the deadline it got. */
const syncedCommands = async (homeDir: string): Promise<string[]> => {
  const { ctx, runner } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  ctx.env['REFS_NETWORK_TIMEOUT'] = String(DEADLINE_SECONDS);
  await initHome(ctx);
  const home = resolveHome(ctx.env);
  await mkdir(`${checkoutPath(home, REF_KEY)}/.git`, { recursive: true });
  const { settings } = await readConfig(home);
  scriptAll(runner, home.hooksDir);
  await syncCheckout(ctx, { home, key: REF_KEY, ref: REF_ENTRY, settings });
  return runner.calls
    .filter((call) => call.timeoutMs !== undefined)
    .map((call) => `${call.args.join(' ')} @${String(call.timeoutMs)}`);
};

describe('refs sync under REFS_NETWORK_TIMEOUT', () => {
  it('puts the deadline on the commands that contact the remote, and only on those', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await expect(syncedCommands(homeDir)).resolves.toStrictEqual([
        `fetch --prune --tags origin @${String(DEADLINE_MS)}`,
        `remote set-head origin --auto @${String(DEADLINE_MS)}`,
      ]);
    });
  });
});
