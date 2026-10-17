import { EXIT, SpawnRunner } from '@kaisers-io/refs-core';
import { access, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { Runner } from '@kaisers-io/refs-core';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { setupSourceFixture } from '../helpers/add-guards-support.ts';

const configureFailure = (): void => {
  vi.stubEnv('GIT_CONFIG_COUNT', '2');
  vi.stubEnv('GIT_CONFIG_KEY_0', 'filter.refs-fail.required');
  vi.stubEnv('GIT_CONFIG_VALUE_0', 'true');
  vi.stubEnv('GIT_CONFIG_KEY_1', 'filter.refs-fail.smudge');
  vi.stubEnv('GIT_CONFIG_VALUE_1', 'git --refs-invalid-fixture-option');
};

const observePartial = (dest: string): { runner: Runner; observed: () => boolean } => {
  const real = new SpawnRunner();
  let partial = false;
  return {
    observed: () => partial,
    runner: {
      run: async (cmd, args, opts) => {
        const result = await real.run(cmd, args, opts);
        if (args[0] === 'clone') {
          const config = await readFile(join(dest, '.git', 'config'), 'utf8');
          partial = result.exitCode !== 0 && config.toLowerCase().includes('hookspath');
        }
        return result;
      },
    },
  };
};

const requireFilter = async (
  fixture: Awaited<ReturnType<typeof setupSourceFixture>>,
): Promise<void> => {
  const cwd = fileURLToPath(fixture.sourceUrl);
  await writeFile(join(cwd, '.gitattributes'), 'README.md filter=refs-fail\n');
  const committed = await fixture.ctx.runner.run(
    'git',
    ['commit', '-qam', 'require a failing fixture filter'],
    { cwd },
  );
  expect(committed.exitCode).toBe(0);
};

const exerciseCheckoutFailure = async (homeDir: string): Promise<void> => {
  const fixture = await setupSourceFixture(homeDir);
  await requireFilter(fixture);
  const observed = observePartial(fixture.dest);
  fixture.ctx.runner = observed.runner;
  configureFailure();
  await run(fixture.ctx, ['node', 'refs', 'add', fixture.sourceUrl, '--dry-run', '--json']);
  expect({ exitCode: process.exitCode, initializedPartial: observed.observed() }).toStrictEqual({
    exitCode: EXIT.VALIDATION,
    initializedPartial: true,
  });
  await expect(access(fixture.dest)).rejects.toThrow(/ENOENT/u);
};

describe(
  'failed materialization after clone initialization',
  { timeout: SLOW_IO_TIMEOUT_MS },
  () => {
    it('removes the newly owned checkout even though Git already wrote its managed hooks marker', async () => {
      expect.hasAssertions();
      try {
        await withResetExitCode(() => withTempHome(exerciseCheckoutFailure));
      } finally {
        vi.unstubAllEnvs();
      }
    });
  },
);
