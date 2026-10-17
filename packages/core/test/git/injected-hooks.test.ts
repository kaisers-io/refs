import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const EXECUTABLE = 0o755;

const trackHook = async (source: string, marker: string): Promise<void> => {
  const hookDir = join(source, '.githooks');
  await mkdir(hookDir);
  const hook = join(hookDir, 'post-checkout');
  // Use Node so the probe works with Git for Windows as well as POSIX Git.
  const script = join(source, 'hook.cjs');
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  await writeFile(hook, `#!/bin/sh\n"${process.execPath.replaceAll('\\', '/')}" hook.cjs\n`);
  await chmod(hook, EXECUTABLE);
  await exec('git', ['add', '-A'], { cwd: source });
  await exec('git', ['update-index', '--chmod=+x', '.githooks/post-checkout'], { cwd: source });
  await exec('git', ['commit', '-qm', 'Synthetic hook fixture'], { cwd: source });
};

const fixture = async () => {
  const source = await createFixtureRepo();
  const root = await mkdtemp(join(tmpdir(), 'refs-injected-hooks-'));
  onTestFinished(async () => {
    vi.unstubAllEnvs();
    await Promise.all([root, source.dir].map((dir) => rm(dir, { force: true, recursive: true })));
  });
  const marker = join(root, 'executed');
  await trackHook(source.dir, marker);
  return { marker, root, source };
};

describe('inherited command-scope hooks during clone', () => {
  it(
    'overrides injected hooksPath while retaining the managed local marker',
    async () => {
      expect.hasAssertions();
      const setup = await fixture();
      vi.stubEnv('GIT_CONFIG_PARAMETERS', "'core.hooksPath=.githooks'");
      const dest = join(setup.root, 'checkout');
      const hooksDir = join(setup.root, 'hooks');
      await cloneRepo(new SpawnRunner(), {
        cloneUrl: setup.source.url,
        dest,
        hooksDir,
        mode: 'full',
      });
      await expect(readFile(setup.marker)).rejects.toMatchObject({ code: 'ENOENT' });
      const local = await exec('git', ['config', '--local', '--get', 'core.hooksPath'], {
        cwd: dest,
      });
      expect(local.stdout.trim()).toBe(hooksDir);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
