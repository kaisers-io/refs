import { REPOSITORY_LOCAL_GIT_VARIABLES, childEnv } from '../../src/proc/child-env.ts';
import { describe, expect, it } from 'vitest';
import { mkdtemp, realpath } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// What refs' children inherit. The policy is git's own `sanitize_repo_env()`: drop the
// repository-locating variables, keep everything else — in particular the command-scope config CI
// uses to inject credentials and `insteadOf` rewrites.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SUCCESS_EXIT_CODE = 0;

/** Variables that describe HOW git runs, which a user or CI sets on purpose. */
const KEPT = {
  GIT_ASKPASS: '/usr/bin/askpass',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_KEY_0: 'url.https://mirror.example/.insteadOf',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_PARAMETERS: "'credential.helper'='store'",
  GIT_CONFIG_VALUE_0: 'https://github.com/',
  GIT_SSH_COMMAND: 'ssh -i key',
  GIT_TERMINAL_PROMPT: '0',
  GIT_TRACE: '1',
  HTTPS_PROXY: 'http://proxy:3128',
  PATH: '/usr/bin',
};

const allLocal = (): Record<string, string> =>
  Object.fromEntries([...REPOSITORY_LOCAL_GIT_VARIABLES].map((name) => [name, `/x/${name}`]));

describe('the environment refs hands its children', () => {
  it('drops every repository-locating variable and keeps the rest', () => {
    expect.hasAssertions();
    expect(childEnv({ ...allLocal(), ...KEPT }, 'linux')).toStrictEqual(KEPT);
  });

  it('matches names case-insensitively on Windows, where git_dir IS GIT_DIR', () => {
    expect.hasAssertions();
    const env = { Git_Dir: '/x', Path: 'C:\\bin', git_index_file: '/y' };
    expect(childEnv(env, 'win32')).toStrictEqual({ Path: 'C:\\bin' });
  });

  it('leaves a lowercase name alone elsewhere, where git never reads it', () => {
    expect.hasAssertions();
    const env = { git_dir: '/x' };
    expect(childEnv(env, 'linux')).toStrictEqual(env);
  });

  it('never mutates the environment it was given', () => {
    expect.hasAssertions();
    const env = { GIT_DIR: '/x', PATH: '/usr/bin' };
    childEnv(env, 'linux');
    expect(env).toStrictEqual({ GIT_DIR: '/x', PATH: '/usr/bin' });
  });
});

const runner = new SpawnRunner();

const gitIn = async (dir: string, args: readonly string[]): Promise<string> => {
  const result = await runner.run('git', args, { cwd: dir });
  expect(result.exitCode).toBe(SUCCESS_EXIT_CODE);
  return result.stdout.trim();
};

const restore = (previous: readonly (readonly [string, string | undefined])[]): void => {
  for (const [name, value] of previous) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }
};

/** Sets `vars` on this process — where `SpawnRunner` takes its children's environment from — for
 * the duration of `exercise`, and puts the previous values back however it ends. */
const withEnv = async <Result>(
  vars: Record<string, string>,
  exercise: () => Promise<Result>,
): Promise<Result> => {
  const previous = Object.keys(vars).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, vars);
  try {
    return await exercise();
  } finally {
    restore(previous);
  }
};

describe('spawned git under an inherited GIT_DIR', SUITE_OPTS, () => {
  it('strips everything the installed git calls repository-local, but its two exceptions', async () => {
    expect.hasAssertions();
    // Ground truth from git itself, so a git that grows the list fails here rather than leaking.
    const published = await gitIn(tmpdir(), ['rev-parse', '--local-env-vars']);

    const passedThrough = published
      .split('\n')
      .filter((name) => !REPOSITORY_LOCAL_GIT_VARIABLES.has(name));

    expect(passedThrough).toStrictEqual(['GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']);
  });

  it('addresses the repository at cwd, not the one GIT_DIR names', async () => {
    expect.hasAssertions();
    const created = await mkdtemp(join(tmpdir(), 'refs-childenv-'));
    const scratch = await realpath(created);
    await gitIn(scratch, ['init', '-q', 'mine']);
    await gitIn(scratch, ['init', '-q', 'sentinel']);
    const mine = join(scratch, 'mine');
    const exercise = (): Promise<string> => gitIn(mine, ['rev-parse', '--absolute-git-dir']);

    const seen = await withEnv({ GIT_DIR: join(scratch, 'sentinel', '.git') }, exercise);

    expect(seen).toBe(join(mine, '.git'));
  });

  it('still receives command-scope config injected through GIT_CONFIG_COUNT', async () => {
    expect.hasAssertions();
    const scratch = await mkdtemp(join(tmpdir(), 'refs-childenv-'));
    const injected = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'refs.probe',
      GIT_CONFIG_VALUE_0: 'kept',
    };

    const value = await withEnv(injected, () => gitIn(scratch, ['config', '--get', 'refs.probe']));

    expect(value).toBe('kept');
  });
});
