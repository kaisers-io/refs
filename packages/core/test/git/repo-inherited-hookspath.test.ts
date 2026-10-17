import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

// refs passes `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` through to git on purpose
// (`proc/child-env.ts`), and git exports the first to every hook it runs under `git -c`. Both are
// COMMAND-scope configuration, which outranks the repository-local `core.hooksPath` marker. So an
// inherited relative `core.hooksPath=.githooks` pointed refs' clone and sync at hooks the cloned
// repository itself tracks. Driven through real git against a `file://` fixture.

const runner = new SpawnRunner();
const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const HOOK_MODE = 0o755;
const SUCCESS_EXIT_CODE = 0;

const INHERITED = {
  GIT_CONFIG_COUNT: {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '.githooks',
  },
  GIT_CONFIG_PARAMETERS: { GIT_CONFIG_PARAMETERS: "'core.hookspath'='.githooks'" },
} as const;

const git = async (dir: string, args: readonly string[]): Promise<string> => {
  const result = await runner.run('git', args, { cwd: dir });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`fixture git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const commitAll = async (dir: string, message: string): Promise<void> => {
  await git(dir, ['add', '-A']);
  await git(dir, ['-c', 'user.name=F', '-c', 'user.email=f@example.com', 'commit', '-qm', message]);
};

/** An upstream tracking an executable `.githooks/post-checkout` that writes `marker`. */
const upstreamTrackingHook = async (marker: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-hookfixture-'));
  await mkdir(join(dir, '.githooks'));
  const hook = join(dir, '.githooks', 'post-checkout');
  await writeFile(hook, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`);
  await chmod(hook, HOOK_MODE);
  await git(dir, ['init', '-q', '-b', 'main']);
  await commitAll(dir, 'tracks a relative hook');
  return dir;
};

const withEnv = async (vars: Record<string, string>, exercise: () => Promise<unknown>) => {
  const previous = Object.keys(vars).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, vars);
  try {
    await exercise();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }
};

const scenario = async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'refs-hookmarker-'));
  const marker = join(scratch, 'upstream-hook-ran');
  const upstream = await upstreamTrackingHook(marker);
  const opts = {
    cloneUrl: pathToFileURL(upstream).href,
    dest: join(scratch, 'checkout'),
    hooksDir: join(scratch, 'refs-hooks'),
    mode: 'full' as const,
  };
  return { marker, opts, upstream };
};

describe.each(Object.entries(INHERITED))('under an inherited %s core.hooksPath', (_name, vars) => {
  it('cloneRepo runs none of the cloned repository own hooks', SUITE_OPTS, async () => {
    expect.hasAssertions();
    const { marker, opts } = await scenario();

    await withEnv(vars, () => cloneRepo(runner, opts));

    await expect(exists(marker)).resolves.toBe(false);
    await expect(git(opts.dest, ['config', '--local', 'core.hooksPath'])).resolves.toBe(
      opts.hooksDir,
    );
  });

  it('syncRef updates the checkout without running its hooks', SUITE_OPTS, async () => {
    expect.hasAssertions();
    const { marker, opts, upstream } = await scenario();
    await cloneRepo(runner, opts);
    await writeFile(join(upstream, 'next.txt'), 'next\n');
    await commitAll(upstream, 'advance');
    const sync = () =>
      syncRef(runner, { defaultBranch: 'main', dir: opts.dest, hooksDir: opts.hooksDir });

    await withEnv(vars, sync);

    await expect(exists(marker)).resolves.toBe(false);
    await expect(git(opts.dest, ['rev-parse', 'HEAD'])).resolves.toBe(
      await git(upstream, ['rev-parse', 'HEAD']),
    );
  });
});
