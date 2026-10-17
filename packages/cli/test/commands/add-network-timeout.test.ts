import { EXIT, checkoutPath, zRefKey } from '@kaisers-io/refs-core';
import { access, readdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  parseLastEnvelope,
  runAddDryRunJson,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { incompleteMarker } from '../../src/commands/clone-lifecycle.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { setupSourceFixture } from '../helpers/add-guards-support.ts';
import { withGitServer } from '../helpers/stalled-git-server.ts';

const SOURCE = 'https://example.com/timeout/repo.git';
const KEY = zRefKey.parse('example.com/timeout/repo');
const DEADLINE_MS = '1000';
const AUTH_DEADLINE_MS = '10000';

type FailureEnvelope = { error: { message: string }; ok: boolean };
const rewrite = (target: string): void => {
  vi.stubEnv('GIT_CONFIG_COUNT', '1');
  vi.stubEnv('GIT_CONFIG_KEY_0', `url.${target}.insteadOf`);
  vi.stubEnv('GIT_CONFIG_VALUE_0', SOURCE);
  vi.stubEnv('REFS_GIT_TIMEOUT_MS', DEADLINE_MS);
};

// This case tests Git's terminal fallback, not a host credential manager or GUI askpass.
// Helpers are deliberately preserved in production and covered by git-credential-compat.test.ts.
const prepareTerminalAuth = async (url: string, dir: string): Promise<void> => {
  rewrite(url);
  const config = join(dir, 'empty-auth-config');
  await writeFile(config, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('REFS_GIT_TIMEOUT_MS', AUTH_DEADLINE_MS);
  vi.stubEnv('GIT_ASKPASS', '');
  vi.stubEnv('SSH_ASKPASS', '');
  vi.stubEnv('GIT_CONFIG_PARAMETERS', '');
  // eslint-disable-next-line unicorn/no-useless-undefined -- emulate an absent inherited variable
  vi.stubEnv('GIT_TERMINAL_PROMPT', undefined);
};

const expectCleanFailure = async (
  fixture: Awaited<ReturnType<typeof setupSourceFixture>>,
): Promise<string> => {
  const envelope = parseLastEnvelope(fixture.stdout) as FailureEnvelope;
  expect({ code: process.exitCode, ok: envelope.ok }).toStrictEqual({
    code: EXIT.VALIDATION,
    ok: false,
  });
  expect(envelope.error.message).toContain('timed out after 1000ms');
  const dest = checkoutPath(fixture.home, KEY);
  await expect(access(dest)).rejects.toThrow(/ENOENT/u);
  await expect(access(incompleteMarker(dest))).rejects.toThrow(/ENOENT/u);
  await expect(readdir(fixture.home.locksDir)).resolves.toStrictEqual([]);
  return dest;
};

const exerciseFailure = async (homeDir: string, url: string): Promise<void> => {
  const fixture = await setupSourceFixture(homeDir);
  rewrite(url);
  await run(fixture.ctx, ['node', 'refs', 'add', SOURCE, '--dry-run', '--json']);
  const dest = await expectCleanFailure(fixture);
  rewrite(fixture.sourceUrl);
  const proposal = await runAddDryRunJson(fixture.ctx, fixture.stdout, SOURCE);
  expect(proposal.key).toBe(KEY);
  await expect(access(dest)).resolves.toBeUndefined();
};

describe('real stalled Git clone', { timeout: SLOW_IO_TIMEOUT_MS }, () => {
  it('returns a JSON error, removes the partial checkout, releases the lock, and retries successfully', async () => {
    expect.hasAssertions();
    try {
      await withResetExitCode(() =>
        withTempHome((homeDir) => withGitServer(false, (url) => exerciseFailure(homeDir, url))),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('disables interactive terminal credentials and explains helper/askpass setup', async () => {
    expect.hasAssertions();
    try {
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSourceFixture(homeDir);
          await withGitServer(true, async (url) => {
            await prepareTerminalAuth(url, homeDir);
            await run(ctx, ['node', 'refs', 'add', SOURCE, '--dry-run', '--json']);
            const envelope = parseLastEnvelope(stdout) as FailureEnvelope;
            expect(envelope.error.message).toContain('terminal prompts disabled');
            expect(envelope.error.message).toContain('Git credential helper or GIT_ASKPASS');
            expect(envelope.error.message).not.toContain('timed out');
          });
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
