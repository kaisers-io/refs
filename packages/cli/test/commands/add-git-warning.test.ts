import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { Runner } from '@kaisers-io/refs-core';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { addGitWarning } from '../../src/commands/add-git-warning.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';

import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

const CONFIG = 'global\0filter.example.smudge\ncat\0';
const withConfig = (real: Runner): Runner => ({
  run: (cmd, args, opts) =>
    args[0] === 'config' && args[1] === '--list'
      ? Promise.resolve({ exitCode: 0, stderr: '', stdout: CONFIG })
      : real.run(cmd, args, opts),
});

describe('pre-clone git execution warning', () => {
  it('warns about an unreadable config instead of asserting it is safe', async () => {
    expect.hasAssertions();
    const setup = testContext();
    setup.runner.expect('git config', { exitCode: 1 });
    await expect(addGitWarning(setup.ctx, '/home')).resolves.toContain('could not be checked');
    expect(setup.stderr.join('\n')).toContain('git-exec-surfaces');
  });

  it(
    'retains the warning in dry-run JSON and emits it before cloning',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const setup = realContextFor(homeDir);
          await initHome(setup.ctx);
          const fixture = await createFixtureRepo();
          const ctx = { ...setup.ctx, runner: withConfig(setup.ctx.runner) };
          await run(ctx, ['node', 'refs', 'add', fixture.url, '--dry-run', '--json']);
          const envelope = parseLastEnvelope(setup.stdout) as { ok: boolean; warnings: string[] };
          expect(envelope.ok).toBe(true);
          expect(envelope.warnings.join(' ')).toContain('filter.example.smudge');
          expect(setup.stderr.findIndex((line) => line.includes('git-exec-surfaces'))).toBeLessThan(
            setup.stderr.findIndex((line) => line.includes('cloning')),
          );
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
