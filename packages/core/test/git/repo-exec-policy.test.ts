import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

// refs' git execution policy (#194, `git-exec-policy.ts`) against real git, through the real
// boundary: the ambient configuration comes from `GIT_CONFIG_GLOBAL`, as a user's would, and the
// program it names is a script the CLONED repository tracks — the shape that makes these settings
// an execution surface. The developer's own git config is never read or written.

const runner = new SpawnRunner();
const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SCRIPT_MODE = 0o755;
const SUCCESS_EXIT_CODE = 0;
// The first git whose `hook.<event>.enabled` disables configured hooks by event.
const EVENT_SWITCH_MINOR = 55;

const git = async (dir: string, args: readonly string[]): Promise<string> => {
  const result = await runner.run('git', args, { cwd: dir });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`fixture git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** An upstream tracking an executable `run.sh` that appends a line to `marker` when it runs. */
const upstreamTrackingScript = async (marker: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-policyfixture-'));
  await writeFile(join(dir, 'run.sh'), `#!/bin/sh\necho ran >> ${JSON.stringify(marker)}\n`);
  await chmod(join(dir, 'run.sh'), SCRIPT_MODE);
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'fixture@example.com']);
  await git(dir, ['config', 'user.name', 'Fixture']);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'tracks a script']);
  return dir;
};

const withGlobalConfig = async (text: string, body: () => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-gitconfig-'));
  const path = join(dir, 'gitconfig');
  await writeFile(path, text);
  const previous = process.env['GIT_CONFIG_GLOBAL'];
  process.env['GIT_CONFIG_GLOBAL'] = path;
  try {
    await body();
  } finally {
    if (previous === undefined) {
      delete process.env['GIT_CONFIG_GLOBAL'];
    } else {
      process.env['GIT_CONFIG_GLOBAL'] = previous;
    }
  }
};

type Scenario = { dest: string; hooksDir: string; marker: string; upstream: string };

const scenario = async (): Promise<Scenario> => {
  const scratch = await mkdtemp(join(tmpdir(), 'refs-policymarker-'));
  const marker = join(scratch, 'ran');
  const upstream = await upstreamTrackingScript(marker);
  return { dest: join(scratch, 'checkout'), hooksDir: join(scratch, 'hooks'), marker, upstream };
};

/** A clone, then a sync after upstream moved — every git operation refs performs on a checkout. */
const cloneThenUpdate = async (scene: Scenario): Promise<void> => {
  const cloneUrl = pathToFileURL(scene.upstream).href;
  await cloneRepo(runner, { cloneUrl, dest: scene.dest, hooksDir: scene.hooksDir, mode: 'full' });
  await git(scene.upstream, ['commit', '-q', '--allow-empty', '-m', 'moves on']);
  await syncRef(runner, { defaultBranch: 'main', dir: scene.dest, hooksDir: scene.hooksDir });
};

const FSMONITOR_CONFIG = '[core]\n\tfsmonitor = ./run.sh\n';

describe('an fsmonitor command in the ambient configuration', SUITE_OPTS, () => {
  it('never runs during refs clone and sync', async () => {
    expect.hasAssertions();
    const scene = await scenario();
    await withGlobalConfig(FSMONITOR_CONFIG, async () => {
      await cloneThenUpdate(scene);
    });
    await expect(exists(scene.marker)).resolves.toBe(false);
  });

  it('does run for git outside refs policy, so the fixture is live', async () => {
    expect.hasAssertions();
    const scene = await scenario();
    await withGlobalConfig(FSMONITOR_CONFIG, async () => {
      await cloneThenUpdate(scene);
      // `sh` is not git, so the runner adds nothing: this is git exactly as the user has it.
      await runner.run('sh', ['-c', 'git status --porcelain'], { cwd: scene.dest });
    });
    await expect(exists(scene.marker)).resolves.toBe(true);
  });

  it('is not written into the checkout own configuration', async () => {
    expect.hasAssertions();
    const scene = await scenario();
    await withGlobalConfig(FSMONITOR_CONFIG, async () => {
      await cloneThenUpdate(scene);
    });
    const read = await runner.run('git', ['config', '--local', '--get', 'core.fsmonitor'], {
      cwd: scene.dest,
    });
    expect(read.exitCode).not.toBe(SUCCESS_EXIT_CODE);
  });
});

const gitMinor = async (): Promise<number> => {
  const result = await runner.run('git', ['--version']);
  const match = /^git version 2\.(?<minor>\d+)/u.exec(result.stdout);
  return Number(match?.groups?.['minor'] ?? 0);
};

// Configured hooks exist from git 2.54 and the event-level switch from 2.55, so this runs only on
// such a git — put one first on PATH to run it. On 2.54 the hook still fires: that gap is reported
// by `doctor` and `add`, not claimed closed.
const HOOKS_CONFIG = ['post-checkout', 'post-index-change', 'reference-transaction']
  .map(
    (event) =>
      `[hook "label-${event}"]\n\tevent = ${event}\n\tcommand = [ ! -x ./run.sh ] || ./run.sh\n`,
  )
  .join('');

describe.skipIf((await gitMinor()) < EVENT_SWITCH_MINOR)(
  'configured hooks in the ambient configuration',
  SUITE_OPTS,
  () => {
    it('never run during refs clone and sync', async () => {
      expect.hasAssertions();
      const scene = await scenario();
      await withGlobalConfig(HOOKS_CONFIG, async () => {
        await cloneThenUpdate(scene);
      });
      await expect(exists(scene.marker)).resolves.toBe(false);
    });

    it('do run for git outside refs policy, so the fixture is live', async () => {
      expect.hasAssertions();
      const scene = await scenario();
      await withGlobalConfig(HOOKS_CONFIG, async () => {
        await cloneThenUpdate(scene);
        await runner.run('sh', ['-c', 'git reset -q --hard HEAD'], { cwd: scene.dest });
      });
      await expect(exists(scene.marker)).resolves.toBe(true);
    });
  },
);
