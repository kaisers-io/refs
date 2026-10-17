import { addCommit, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { REPO_LOCAL_GIT_ENV } from '../../src/proc/child-env.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// refs names a checkout by path (`cwd`); git lets `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE`
// override that, and exports them to every hook. These cases run real git with those variables
// pointing at a SENTINEL repository — standing in for the user's own project when refs is started
// from one of its hooks — and assert the sentinel is exactly as it was.

const runner = new SpawnRunner();
const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SUCCESS_EXIT_CODE = 0;
const HOOK_MODE = 0o755;
const FIXTURE_README = '# fixture repo\n';
const LOCAL_EDIT = 'local edit\n';
const UNTRACKED = 'keep me\n';
/** Kept on purpose, like git's `sanitize_repo_env()`; the empty string is the trailing newline. */
const KEPT_ON_PURPOSE = new Set(['', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']);

const git = async (dir: string, args: readonly string[]): Promise<string> => {
  const result = await runner.run('git', args, { cwd: dir });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`fixture git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
};

/** Runs `fn` with `vars` set in `process.env`, restoring the previous values afterwards. */
const withEnv = async <Result>(
  vars: Record<string, string>,
  fn: () => Promise<Result>,
): Promise<Result> => {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const localHooksPath = async (dir: string): Promise<string> => {
  const result = await runner.run('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: dir,
  });
  return result.stdout.trim();
};

type Scene = {
  dest: string;
  fixture: { dir: string; url: string };
  hooksDir: string;
  sentinel: string;
};

/** A fixture upstream, plus a clone of it with an uncommitted tracked edit and an untracked file. */
const sceneWithDirtySentinel = async (): Promise<Scene> => {
  const scratch = await mkdtemp(join(tmpdir(), 'refs-env-'));
  const fixture = await createFixtureRepo();
  const sentinel = join(scratch, 'sentinel');
  await git(scratch, ['clone', '-q', '--', fixture.url, sentinel]);
  await writeFile(join(sentinel, 'README.md'), LOCAL_EDIT);
  await writeFile(join(sentinel, 'untracked.txt'), UNTRACKED);
  return { dest: join(scratch, 'checkout'), fixture, hooksDir: join(scratch, 'hooks'), sentinel };
};

const cloneScene = async (scene: Scene, cloneUrl = scene.fixture.url): Promise<void> => {
  await cloneRepo(runner, { cloneUrl, dest: scene.dest, hooksDir: scene.hooksDir, mode: 'full' });
};

/** A scene whose managed checkout is cloned and one upstream commit behind. */
const clonedSceneBehindUpstream = async (): Promise<Scene> => {
  const scene = await sceneWithDirtySentinel();
  await cloneScene(scene);
  await addCommit(scene.fixture.dir, 'NEW.md', 'upstream moved\n');
  return scene;
};

/** Names git reports as repository-local that refs neither clears nor keeps on purpose. */
const unlisted = (reported: readonly string[]): string[] =>
  reported.filter((name) => !KEPT_ON_PURPOSE.has(name) && !REPO_LOCAL_GIT_ENV.has(name));

const expectSentinelUntouched = async (sentinel: string, indexBefore: Buffer): Promise<void> => {
  await expect(readFile(join(sentinel, 'README.md'), 'utf8')).resolves.toBe(LOCAL_EDIT);
  await expect(readFile(join(sentinel, 'untracked.txt'), 'utf8')).resolves.toBe(UNTRACKED);
  await expect(readFile(join(sentinel, '.git', 'index'))).resolves.toStrictEqual(indexBefore);
};

/** An upstream tracking an executable `.githooks/post-checkout` that writes `marker`. */
const trackHook = async (dir: string, marker: string): Promise<void> => {
  await mkdir(join(dir, '.githooks'));
  const hook = join(dir, '.githooks', 'post-checkout');
  await writeFile(hook, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`);
  await chmod(hook, HOOK_MODE);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'tracks a hook']);
};

describe('git children and repository-locating variables', SUITE_OPTS, () => {
  it('clears every variable the installed git reports as repository-local', async () => {
    expect.hasAssertions();
    const reported = await git(tmpdir(), ['rev-parse', '--local-env-vars']);

    expect(unlisted(reported.split('\n'))).toStrictEqual([]);
  });

  it('does not stamp the managed hooks path onto the repository GIT_DIR names', async () => {
    expect.hasAssertions();
    const scene = await sceneWithDirtySentinel();

    await withEnv({ GIT_DIR: join(scene.sentinel, '.git') }, () => cloneScene(scene));

    await expect(localHooksPath(scene.sentinel)).resolves.toBe('');
    await expect(localHooksPath(scene.dest)).resolves.toBe(scene.hooksDir);
  });

  it('syncs the checkout it was given and leaves the inherited work tree untouched', async () => {
    expect.hasAssertions();
    const scene = await clonedSceneBehindUpstream();
    const indexBefore = await readFile(join(scene.sentinel, '.git', 'index'));
    const inherited = {
      GIT_DIR: join(scene.sentinel, '.git'),
      GIT_INDEX_FILE: join(scene.sentinel, '.git', 'index'),
      GIT_WORK_TREE: scene.sentinel,
    };

    const result = await withEnv(inherited, () =>
      syncRef(runner, { defaultBranch: 'main', dir: scene.dest, hooksDir: scene.hooksDir }),
    );

    expect(result.status).toBe('updated');
    await expect(readFile(join(scene.dest, 'NEW.md'), 'utf8')).resolves.toBe('upstream moved\n');
    await expectSentinelUntouched(scene.sentinel, indexBefore);
  });
});

describe('an inherited GIT_INDEX_FILE on its own', SUITE_OPTS, () => {
  // Without `GIT_DIR`, git still finds the checkout from `cwd` but writes its index to the file
  // `GIT_INDEX_FILE` names: the clone's checkout and every later reset would replace the caller's.
  it('keeps an inherited GIT_INDEX_FILE alone from replacing the caller index', async () => {
    expect.hasAssertions();
    const scene = await sceneWithDirtySentinel();
    const index = join(scene.sentinel, '.git', 'index');
    const indexBefore = await readFile(index);

    const result = await withEnv({ GIT_INDEX_FILE: index }, async () => {
      await cloneScene(scene);
      await addCommit(scene.fixture.dir, 'NEW.md', 'upstream moved\n');
      return syncRef(runner, { defaultBranch: 'main', dir: scene.dest, hooksDir: scene.hooksDir });
    });

    expect(result.status).toBe('updated');
    await expect(git(scene.dest, ['status', '--porcelain'])).resolves.toBe('');
    await expectSentinelUntouched(scene.sentinel, indexBefore);
  });
});

// `GIT_CONFIG_PARAMETERS` in its `'key=value'` form, which is what `git -c` exports and what every
// git refs runs on reads; `GIT_CONFIG_COUNT` only exists from git 2.31.
describe('inherited command-scope configuration', SUITE_OPTS, () => {
  it('still reaches git, so injected url rewrites keep working', async () => {
    expect.hasAssertions();
    const scene = await sceneWithDirtySentinel();
    const unreachable = 'https://refs-fixture.invalid/upstream.git';
    const rewrite = {
      GIT_CONFIG_PARAMETERS: `'url.${scene.fixture.url}.insteadOf=${unreachable}'`,
    };

    await withEnv(rewrite, () => cloneScene(scene, unreachable));

    await expect(readFile(join(scene.dest, 'README.md'), 'utf8')).resolves.toBe(FIXTURE_README);
  });

  it('cannot point the clone at hooks the cloned repository ships', async () => {
    expect.hasAssertions();
    const scene = await sceneWithDirtySentinel();
    const marker = join(scene.hooksDir, '..', 'upstream-hook-ran');
    await trackHook(scene.fixture.dir, marker);
    const injected = { GIT_CONFIG_PARAMETERS: "'core.hooksPath=.githooks'" };

    await withEnv(injected, () => cloneScene(scene));

    await expect(exists(marker)).resolves.toBe(false);
    await expect(localHooksPath(scene.dest)).resolves.toBe(scene.hooksDir);
  });
});
