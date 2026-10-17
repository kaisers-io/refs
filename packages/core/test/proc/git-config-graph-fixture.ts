import type { ConfigContext, GitConfigRun } from '../../src/proc/git-config-graph.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readGitConfigGraph } from '../../src/proc/git-config-graph.ts';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const MAX_BUFFER = 2_097_152;
const TIMEOUT_MS = 10_000;

type Fixture = Awaited<ReturnType<typeof makeFixture>>;

const rawGit =
  (cwd: string, env: NodeJS.ProcessEnv): GitConfigRun =>
  async (args) => {
    try {
      const result = await exec('git', [...args], {
        cwd,
        env,
        maxBuffer: MAX_BUFFER,
        timeout: TIMEOUT_MS,
      });
      return { ...result, exitCode: 0 };
    } catch (error) {
      const stderr =
        error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
          ? error.stderr
          : 'Git command failed';
      return { exitCode: 1, stderr, stdout: '' };
    }
  };

const makeFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'refs-config-graph-'));
  const home = join(root, 'home');
  const config = join(home, '.gitconfig');
  const cwd = join(root, 'work');
  await Promise.all([mkdir(home), mkdir(cwd)]);
  await writeFile(config, '');
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: home,
    LC_ALL: 'C',
    PATH: process.env['PATH'],
  };
  return { config, cwd, env, home, root };
};

const readFixture = (fixture: Fixture, options?: Partial<ConfigContext>) => {
  const context = { cwd: fixture.cwd, env: fixture.env, protectedRoots: [], ...options };
  return readGitConfigGraph(rawGit(context.cwd, fixture.env), context);
};

const withFixture = async (test: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const fixture = await makeFixture();
  try {
    await test(fixture);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
};

const prepareInvalid = async (fixture: Fixture, kind: string): Promise<void> => {
  const path = join(fixture.home, 'source');
  await writeFile(fixture.config, '[include]\npath=source\n');
  const setups: Record<string, () => Promise<unknown>> = {
    cycle: () => writeFile(path, '[include]\npath=source\n'),
    directory: () => mkdir(path),
    implicit: () => writeFile(fixture.config, '[include]\npath\n'),
    nonutf8: () =>
      writeFile(path, Buffer.from('[hook "bad\u00FF"]\ncommand=secret-never-disclose\n', 'latin1')),
    'relative-env': async () => {
      await writeFile(fixture.config, '');
      Object.assign(fixture.env, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'include.path',
        GIT_CONFIG_VALUE_0: 'relative-secret-path',
      });
    },
  };
  await setups[kind]?.();
};

export { prepareInvalid, rawGit, readFixture, withFixture };
export type { Fixture };
