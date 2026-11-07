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
// The first git with configured hooks: 2.54 disables them by label, 2.55 and later by event.
const CONFIGURED_HOOKS_MINOR = 54;

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

/** Writes `files` into a fresh directory and returns the path of its `gitconfig`. */
const configFiles = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-gitconfig-'));
  for (const [name, content] of Object.entries(files)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of fixture files
    await writeFile(join(dir, name), content);
  }
  return join(dir, 'gitconfig');
};

/** `text` as the global configuration; `beside` are further files next to it, for includes. */
const withGlobalConfig = async (
  text: string,
  body: () => Promise<void>,
  beside: Readonly<Record<string, string>> = {},
): Promise<void> => {
  const path = await configFiles({ ...beside, gitconfig: text });
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

// Configured hooks exist from git 2.54, so this runs only on such a git — put one first on PATH to
// run it. 2.55 disables them by event; 2.54 only by label, which is what the include below tests:
// its condition is decided by the repository being cloned, so the hook it adds is invisible to
// any listing taken before the clone, and it fired during refs' clone until the label inventory
// read inactive includes too.
const hookSection = (label: string, event: string): string =>
  `[hook "${label}"]\n\tevent = ${event}\n\tcommand = [ ! -x ./run.sh ] || ./run.sh\n`;
const HOOKS_CONFIG = [
  ...['post-checkout', 'post-index-change', 'reference-transaction'].map((event) =>
    hookSection(`label-${event}`, event),
  ),
  '[includeIf "hasconfig:remote.*.url:file://**"]\n\tpath = hidden.gitconfig\n',
].join('');
const HIDDEN_HOOK = { 'hidden.gitconfig': hookSection('only.for clones', 'post-checkout') };

describe.skipIf((await gitMinor()) < CONFIGURED_HOOKS_MINOR)(
  'configured hooks in the ambient configuration',
  SUITE_OPTS,
  () => {
    it('never run during refs clone and sync', async () => {
      expect.hasAssertions();
      const scene = await scenario();
      await withGlobalConfig(
        HOOKS_CONFIG,
        async () => {
          await cloneThenUpdate(scene);
        },
        HIDDEN_HOOK,
      );
      await expect(exists(scene.marker)).resolves.toBe(false);
    });

    it('do run for git outside refs policy, so the fixture is live', async () => {
      expect.hasAssertions();
      const scene = await scenario();
      await withGlobalConfig(
        HOOKS_CONFIG,
        async () => {
          await cloneThenUpdate(scene);
          await runner.run('sh', ['-c', 'git reset -q --hard HEAD'], { cwd: scene.dest });
        },
        HIDDEN_HOOK,
      );
      await expect(exists(scene.marker)).resolves.toBe(true);
    });

    it('include the conditional one, which applies inside the checkout', async () => {
      expect.hasAssertions();
      const scene = await scenario();
      const onlyHidden = HOOKS_CONFIG.slice(HOOKS_CONFIG.indexOf('[includeIf'));
      await withGlobalConfig(
        onlyHidden,
        async () => {
          await cloneThenUpdate(scene);
          await runner.run('sh', ['-c', 'git checkout -q -B main HEAD'], { cwd: scene.dest });
        },
        HIDDEN_HOOK,
      );
      await expect(exists(scene.marker)).resolves.toBe(true);
    });
  },
);

// On 2.55 a label named after an event makes `hook.<event>.enabled` that label's switch, so the
// event switch alone left `x` running — reproduced on 2.55.0 before labels were disabled there.
const COLLIDING = `[hook "post-checkout"]\n\tcommand = true\n${hookSection('x', 'post-checkout')}`;

describe.skipIf((await gitMinor()) < CONFIGURED_HOOKS_MINOR)(
  'a configured hook label named after an event',
  SUITE_OPTS,
  () => {
    it('leaves no other label on that event running during refs clone and sync', async () => {
      expect.hasAssertions();
      const scene = await scenario();
      const ran: boolean[] = [];
      await withGlobalConfig(COLLIDING, async () => {
        await cloneThenUpdate(scene);
        ran.push(await exists(scene.marker));
        // The same configuration under plain git, outside refs' policy: the fixture is live.
        await runner.run('sh', ['-c', 'git checkout -q -B main HEAD'], { cwd: scene.dest });
        ran.push(await exists(scene.marker));
      });
      expect(ran).toStrictEqual([false, true]);
    });
  },
);
