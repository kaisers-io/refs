import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { HookLabelCache } from '../../src/proc/git-hook-label-cache.ts';
import type { RunResult } from '../../src/proc/runner.ts';
import { execFile } from 'node:child_process';
import { hookLabelArgs } from '../../src/proc/git-hook-labels.ts';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// The label inventory kept between commands (`git-hook-label-cache.ts`), through real git reading
// real files. Every case counts the `git config` reads the second command needs: none means the
// inventory came from the cache, and the assertion on the outcome says whether it was right to.

type AfterRead = (args: readonly string[]) => Promise<void>;
type Scene = {
  afterRead?: AfterRead | undefined;
  dir: string;
  global: string;
  reads: number;
  work: string;
};
type Outcome = { args: string[] } | { refusal: string };

const execGit = promisify(execFile);
const MS_PER_S = 1000;
const HOUR_S = 3600;

const sceneWith = async (files: Readonly<Record<string, string>>): Promise<Scene> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-labelcache-'));
  for (const [name, content] of Object.entries(files)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of fixture files
    await writeFile(join(dir, name), content);
  }
  const work = join(dir, 'work');
  await mkdir(work);
  return { dir, global: join(dir, 'gitconfig'), reads: 0, work };
};

const runGit = async (scene: Scene, args: readonly string[]): Promise<RunResult> => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: scene.global, GIT_CONFIG_NOSYSTEM: '1' };
  try {
    const { stderr, stdout } = await execGit('git', [...args], { cwd: scene.work, env });
    return { exitCode: 0, stderr, stdout };
  } catch (error) {
    const failed = error as { code: number; stderr: string; stdout: string };
    return { exitCode: failed.code, stderr: failed.stderr, stdout: failed.stdout };
  }
};

/** Plain git under the scene's global config, counting every call. */
const reader =
  (scene: Scene) =>
  async (args: readonly string[]): Promise<RunResult> => {
    scene.reads += 1;
    const result = await runGit(scene, args);
    await scene.afterRead?.(args);
    return result;
  };

const hook = (label: string): string =>
  `[hook "${label}"]\n\tevent = post-checkout\n\tcommand = ./x\n`;

/** One command's labels, through `store`, and how many reads it took. */
const labelsVia = async (
  scene: Scene,
  store: HookLabelCache,
  args: readonly string[] = ['status'],
): Promise<{ outcome: Outcome; reads: number }> => {
  const before = scene.reads;
  const cache = { key: scene.work, store };
  const outcome = await hookLabelArgs(reader(scene), { args, cache, cwd: scene.work });
  return { outcome, reads: scene.reads - before };
};

const labelsOf = (outcome: Outcome): string[] =>
  'refusal' in outcome ? [outcome.refusal] : outcome.args.filter((arg) => arg !== '-c').toSorted();

/** Two commands on one cache, with `between` run after the first. */
const twice = async (scene: Scene, between: () => Promise<void>): Promise<string[]> => {
  const store = new HookLabelCache();
  await labelsVia(scene, store);
  await between();
  const second = await labelsVia(scene, store);
  return labelsOf(second.outcome);
};

/** Rewrites `path` once, right after git first lists it. */
const editAfterListing = (scene: Scene, path: string, content: string): void => {
  scene.afterRead = async (args): Promise<void> => {
    if (args.includes(path) && args.includes('--list')) {
      scene.afterRead = undefined;
      await writeFile(path, content);
    }
  };
};

describe('the label inventory between commands', () => {
  it('is reused, without a git call, while nothing it read has changed', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({
      gitconfig: `${hook('top')}[include]\n\tpath = inc\n`,
      inc: hook('inner'),
    });
    const store = new HookLabelCache();
    const first = await labelsVia(scene, store);
    const second = await labelsVia(scene, store);
    expect(first.reads).toBeGreaterThan(0);
    expect(second).toStrictEqual({ outcome: first.outcome, reads: 0 });
    expect(labelsOf(second.outcome)).toStrictEqual([
      'hook.inner.enabled=false',
      'hook.top.enabled=false',
    ]);
  });

  it('still refuses an include inside the destination of a later clone', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: '[include]\n\tpath = dest/planted\n' });
    const store = new HookLabelCache();
    await labelsVia(scene, store);
    const clone = ['clone', '-q', '--', 'file:///x', join(scene.dir, 'dest')];
    const second = await labelsVia(scene, store, clone);
    expect(second.reads).toBe(0);
    expect(labelsOf(second.outcome)).toStrictEqual([expect.stringMatching(/inside the checkout/u)]);
  });

  // A device git reads as a file can answer differently each time, so no snapshot vouches for it.
  it.skipIf(process.platform === 'win32')('is not kept when it read a device', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: `${hook('top')}[include]\n\tpath = /dev/null\n` });
    const store = new HookLabelCache();
    await labelsVia(scene, store);
    const second = await labelsVia(scene, store);
    expect(second.reads).toBeGreaterThan(0);
    expect(labelsOf(second.outcome)).toStrictEqual(['hook.top.enabled=false']);
  });
});

describe('the label inventory taken again', () => {
  it('once an included file changes', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: '[include]\n\tpath = inc\n', inc: hook('one') });
    const rewrite = async (): Promise<void> => {
      await writeFile(join(scene.dir, 'inc'), `${hook('one')}${hook('two')}`);
    };
    await expect(twice(scene, rewrite)).resolves.toStrictEqual([
      'hook.one.enabled=false',
      'hook.two.enabled=false',
    ]);
  });

  // What a timestamp cannot tell: a rewrite in the same tick, at the same size.
  it('once a file changes behind the same size and modification time', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: hook('aaa') });
    // Whole seconds, so setting the time again restores it exactly.
    const time = Math.floor(Date.now() / MS_PER_S) - HOUR_S;
    await utimes(scene.global, time, time);
    const rewrite = async (): Promise<void> => {
      await writeFile(scene.global, hook('bbb'));
      await utimes(scene.global, time, time);
    };
    await expect(twice(scene, rewrite)).resolves.toStrictEqual(['hook.bbb.enabled=false']);
  });

  it('once a missing include appears', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: '[include]\n\tpath = later\n' });
    const create = async (): Promise<void> => {
      await writeFile(join(scene.dir, 'later'), hook('late'));
    };
    await expect(twice(scene, create)).resolves.toStrictEqual(['hook.late.enabled=false']);
  });
});

describe('the label inventory taken during an edit', () => {
  // The snapshot is taken before git reads the file, so an edit just after git read it — while
  // the inventory is still running — leaves a snapshot that no longer matches.
  it('is taken again when a file changed just after git read it', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: '[include]\n\tpath = inc\n', inc: hook('one') });
    editAfterListing(scene, join(scene.dir, 'inc'), `${hook('one')}${hook('two')}`);
    await expect(twice(scene, async () => {})).resolves.toStrictEqual([
      'hook.one.enabled=false',
      'hook.two.enabled=false',
    ]);
  });
});
