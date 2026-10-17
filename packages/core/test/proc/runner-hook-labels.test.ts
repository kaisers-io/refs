import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunResult } from '../../src/proc/runner.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// `SpawnRunner` applying the git 2.54 label inventory to a real git command. CI has no 2.54, so a
// stand-in `git` first on PATH answers `--version` as the release under test and hands every other
// call to the real git: the configuration is still read and applied by git itself, and the
// command-scope entries the runner added are visible in git's own listing.

const SCRIPT_MODE = 0o755;
const REFUSED_EXIT_CODE = 1;
const LABEL_KEY = 'hook.for.clones.enabled';

type Scene = { dir: string; global: string };

const sceneWith = async (files: Readonly<Record<string, string>>): Promise<Scene> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-runnerlabels-'));
  for (const [name, content] of Object.entries(files)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of fixture files
    await writeFile(join(dir, name), content);
  }
  return { dir, global: join(dir, 'gitconfig') };
};

/** Puts a `git` first on PATH that reports `version` and is otherwise the real git. */
const asGit = async (version: string, scene: Scene): Promise<void> => {
  const located = await promisify(execFile)('sh', ['-c', 'command -v git']);
  const bin = join(scene.dir, 'bin');
  await mkdir(bin);
  const script = [
    '#!/bin/sh',
    'for last in "$@"; do :; done',
    `if [ "$last" = --version ]; then echo "git version ${version}"; exit 0; fi`,
    `exec ${JSON.stringify(located.stdout.trim())} "$@"`,
  ].join('\n');
  await writeFile(join(bin, 'git'), `${script}\n`);
  await chmod(join(bin, 'git'), SCRIPT_MODE);
  vi.stubEnv('GIT_CONFIG_GLOBAL', scene.global);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env['PATH'] ?? ''}`);
};

/** One `SpawnRunner` call under the stand-in git; the environment is restored afterwards. */
const runAs = async (version: string, scene: Scene, args: string[]): Promise<RunResult> => {
  try {
    await asGit(version, scene);
    return await new SpawnRunner().run('git', args);
  } finally {
    vi.unstubAllEnvs();
  }
};

const HIDDEN = {
  gitconfig: '[includeIf "hasconfig:remote.*.url:https://**"]\n\tpath = hidden\n',
  hidden: '[hook "for.clones"]\n\tevent = post-checkout\n\tcommand = ./run.sh\n',
};

describe.skipIf(process.platform === 'win32')('the runner on git 2.54', () => {
  it('disables a configured hook only an inactive include defines', async () => {
    expect.hasAssertions();
    const scene = await sceneWith(HIDDEN);
    const result = await runAs('2.54.0', scene, ['config', '--get', LABEL_KEY]);
    expect(result.stdout.trim()).toBe('false');
  });

  it('refuses to start git when an include cannot be read', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: '[include]\n\tpath = adir\n' });
    await mkdir(join(scene.dir, 'adir'));
    const target = join(scene.dir, 'never');
    const result = await runAs('2.54.0', scene, ['init', '-q', target]);
    expect(result).toMatchObject({
      exitCode: REFUSED_EXIT_CODE,
      stderr: /refs did not start git/u,
    });
    await expect(stat(target)).rejects.toThrow(/ENOENT/u);
  });

  it('adds no label on git 2.55, whose event switch needs none', async () => {
    expect.hasAssertions();
    const scene = await sceneWith(HIDDEN);
    const result = await runAs('2.55.0', scene, ['config', '--get', LABEL_KEY]);
    expect(result.stdout).toBe('');
  });
});
