import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const runner = new SpawnRunner();
const MODE = 0o755;
const ENCODING = 'utf8';

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'refs-exec-policy-'));
  const source = await createFixtureRepo();
  onTestFinished(async () => {
    await Promise.all([root, source.dir].map((path) => rm(path, { force: true, recursive: true })));
  });
  const marker = join(root, 'marker');
  const script = join(root, 'monitor');
  await writeFile(script, `#!/bin/sh\nprintf ran >> '${marker}'\n`);
  await chmod(script, MODE);
  return {
    dest: join(root, 'checkout'),
    hooksDir: join(root, 'hooks'),
    marker,
    root,
    script,
    source,
  };
};

const ambient = async (key: string, value: string, run: () => Promise<void>): Promise<void> => {
  vi.stubEnv('GIT_CONFIG_COUNT', '1');
  vi.stubEnv('GIT_CONFIG_KEY_0', key);
  vi.stubEnv('GIT_CONFIG_VALUE_0', value);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe.skipIf(process.platform === 'win32')('git execution policy with real git', () => {
  it(
    'disables fsmonitor through the shared runner, even outside gitSpec',
    async () => {
      expect.hasAssertions();
      const setup = await fixture();
      await ambient('core.fsmonitor', setup.script, async () => {
        // Positive control: ambient config really executes this harmless fixture program.
        await exec('git', ['status', '--porcelain'], { cwd: setup.source.dir });
        const before = await readFile(setup.marker, ENCODING);
        const result = await runner.run('git', ['status', '--porcelain'], {
          cwd: setup.source.dir,
        });
        expect(result.exitCode).toBe(0);
        await expect(readFile(setup.marker, ENCODING)).resolves.toBe(before);
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'applies hooksPath above inherited command-scope configuration for clone and sync',
    async () => {
      expect.hasAssertions();
      const setup = await fixture();
      const hooks = join(setup.root, 'ambient-hooks');
      await exec('git', ['init', '-q', hooks]);
      await writeFile(join(hooks, 'post-checkout'), `#!/bin/sh\nprintf ran >> '${setup.marker}'\n`);
      await chmod(join(hooks, 'post-checkout'), MODE);
      await ambient('core.hooksPath', hooks, async () => {
        await cloneRepo(runner, {
          cloneUrl: setup.source.url,
          dest: setup.dest,
          hooksDir: setup.hooksDir,
          mode: 'full',
        });
        const result = await syncRef(runner, {
          defaultBranch: 'main',
          dir: setup.dest,
          hooksDir: setup.hooksDir,
        });
        expect(result.status).toBe('fresh');
        await expect(readFile(setup.marker)).rejects.toMatchObject({ code: 'ENOENT' });
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
