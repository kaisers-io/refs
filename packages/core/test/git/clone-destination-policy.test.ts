import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixture = async () => {
  const source = await createFixtureRepo();
  const root = await mkdtemp(join(tmpdir(), 'refs-clone-destination-'));
  onTestFinished(async () => {
    vi.unstubAllEnvs();
    await Promise.all([root, source.dir].map((dir) => rm(dir, { force: true, recursive: true })));
  });
  const dest = join(root, 'temporary-checkout');
  const config = join(root, 'config');
  const portable = dest.replaceAll('\\', '/');
  await writeFile(
    config,
    `[includeIf "gitdir:${portable}/.git"]\n path = ${portable}/future.config\n`,
  );
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  return { dest, root, source };
};

describe('clone API prospective destination protection', () => {
  it(
    'protects temporary clone destinations outside managed sources before creating them',
    async () => {
      expect.hasAssertions();
      const setup = await fixture();
      // Not under hooksDir/../sources: only correct clone command recognition protects this path.
      await expect(
        cloneRepo(new SpawnRunner(), {
          cloneUrl: setup.source.url,
          dest: setup.dest,
          hooksDir: join(setup.root, 'home', 'hooks'),
          mode: 'full',
        }),
      ).rejects.toThrow(/reference|protected|managed|include|inventoried/iu);
      await expect(access(setup.dest)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
