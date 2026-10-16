import { addCommit, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { basename, join } from 'node:path';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { hasFilterGuard } from '../../src/git/filter-guard.ts';
import { packagesBefore } from '../../src/git/arrivals.ts';
import { tmpdir } from 'node:os';

// refs clones repositories to be read, never to run their code. Each scene names a script the
// cloned repository tracks — through the user's configuration or environment, which is how such a
// script gets reached — and the script appends its name to a log outside the checkout. Clone and
// sync must leave that log empty while still delivering the content.

const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SCRIPT_MODE = 0o755;
const PASS_THROUGH = 'cat';

type Scene = { dest: string; hooksDir: string; log: string; upstream: string };

/** Commits an executable script at `path` that logs its name and copies stdin to stdout. */
const trackScript = async (scene: Scene, path: string): Promise<void> => {
  const name = basename(path);
  await mkdir(join(scene.upstream, path, '..'), { recursive: true });
  await addCommit(
    scene.upstream,
    path,
    `#!/bin/sh\necho ${name} >> ${JSON.stringify(scene.log)}\n${PASS_THROUGH}\n`,
  );
  await chmod(join(scene.upstream, path), SCRIPT_MODE);
  await addCommit(scene.upstream, 'MODE.md', `${path} is executable\n`);
};

const newScene = async (): Promise<Scene> => {
  const scratch = await mkdtemp(join(tmpdir(), 'refs-no-exec-'));
  const { dir: upstream } = await createFixtureRepo();
  const log = join(scratch, 'ran.log');
  await writeFile(log, '');
  return { dest: join(scratch, 'checkout'), hooksDir: join(scratch, 'hooks'), log, upstream };
};

/** Runs `body` with `name` set to `value` in the environment git inherits. */
const withEnv = async (name: string, value: string, body: () => Promise<void>): Promise<void> => {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    await body();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = previous;
    }
  }
};

/** A global git configuration naming the checkout's `tool.sh` for every command-shaped setting a
 * `.gitattributes` or a plain command can reach. */
const toolConfig = async (scene: Scene): Promise<string> => {
  const file = join(scene.dest, '..', 'gitconfig');
  await writeFile(
    file,
    '[filter "y"]\n\tsmudge = ./tool.sh\n\tclean = ./tool.sh\n' +
      '[diff "y"]\n\ttextconv = ./tool.sh\n[diff]\n\texternal = ./tool.sh\n' +
      '[core]\n\tpager = ./tool.sh\n',
  );
  return file;
};

const filterScene = async (): Promise<Scene & { config: string }> => {
  const scene = await newScene();
  await trackScript(scene, 'tool.sh');
  // `* -text` stays first, as in the fixture this replaces: Git for Windows' default
  // `core.autocrlf=true` would otherwise rewrite the bytes the assertions compare.
  await addCommit(scene.upstream, '.gitattributes', '* -text\n*.txt filter=y diff=y\n* diff=y\n');
  await addCommit(scene.upstream, 'a.txt', 'stored\n');
  return { ...scene, config: await toolConfig(scene) };
};

describe('content filters and diff drivers named in the user configuration', SUITE_OPTS, () => {
  it('run neither during a clone, a sync nor the arrivals scan', async () => {
    expect.hasAssertions();
    const scene = await filterScene();
    const runner = new SpawnRunner({ hooksDir: scene.hooksDir });
    const { dest, hooksDir } = scene;
    await withEnv('GIT_CONFIG_GLOBAL', scene.config, async () => {
      await cloneRepo(runner, { cloneUrl: scene.upstream, dest, hooksDir, mode: 'full' });
    });
    await addCommit(scene.upstream, 'a.txt', 'moved\n');
    await addCommit(scene.upstream, 'package.json', '{"name":"arrived"}\n');
    await withEnv('GIT_CONFIG_GLOBAL', scene.config, async () => {
      const synced = await syncRef(runner, { defaultBranch: 'main', dir: dest, hooksDir });
      await packagesBefore(runner, { dir: dest, from: synced.oldSha, to: synced.newSha });
    });

    await expect(readFile(scene.log, 'utf8')).resolves.toBe('');
    await expect(readFile(join(dest, 'a.txt'), 'utf8')).resolves.toBe('moved\n');
  });

  it('stay off in a checkout an older refs cloned without the guard', async () => {
    expect.hasAssertions();
    const scene = await filterScene();
    const runner = new SpawnRunner({ hooksDir: scene.hooksDir });
    const { dest, hooksDir } = scene;
    await runner.run('git', ['clone', '-q', scene.upstream, dest]);
    await runner.run('git', ['config', 'core.hooksPath', hooksDir], { cwd: dest });
    await addCommit(scene.upstream, 'a.txt', 'moved\n');
    await withEnv('GIT_CONFIG_GLOBAL', scene.config, async () => {
      await syncRef(runner, { defaultBranch: 'main', dir: dest, hooksDir });
    });

    await expect(readFile(scene.log, 'utf8')).resolves.toBe('');
    await expect(hasFilterGuard(dest)).resolves.toBe(true);
  });
});

describe('a hooks path inherited through the environment', SUITE_OPTS, () => {
  it('does not run a hook the checkout tracks during a clone or a sync', async () => {
    expect.hasAssertions();
    const scene = await newScene();
    await trackScript(scene, '.githooks/post-checkout');
    const runner = new SpawnRunner({ hooksDir: scene.hooksDir });
    const { dest, hooksDir } = scene;
    await withEnv('GIT_CONFIG_PARAMETERS', "'core.hooksPath=.githooks'", async () => {
      await cloneRepo(runner, { cloneUrl: scene.upstream, dest, hooksDir, mode: 'full' });
      await addCommit(scene.upstream, 'NEW.md', 'upstream moved\n');
      await syncRef(runner, { defaultBranch: 'main', dir: dest, hooksDir });
    });

    await expect(readFile(scene.log, 'utf8')).resolves.toBe('');
    await expect(readFile(join(dest, 'NEW.md'), 'utf8')).resolves.toBe('upstream moved\n');
  });
});
