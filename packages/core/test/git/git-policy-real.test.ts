import { addCommit, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The invoking user's configuration names a command relative to the worktree, and the cloned
// repository tracks a script at that path. Without refs' policy options git runs the CHECKOUT's
// copy: fsmonitor on every version that has it, configured hooks from 2.54 on. Each script appends
// a line to a log outside the checkout, so "nothing ran" is a readable assertion.

const runner = new SpawnRunner();
const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const SCRIPT_MODE = 0o755;
const VERSION = /(?<major>\d+)\.(?<minor>\d+)/u;
const EVENT_SWITCH_SINCE = { major: 2, minor: 55 };

const versionProbe = await runner.run('git', ['--version']);
const installed = VERSION.exec(versionProbe.stdout)?.groups ?? {};
const hasEventSwitch =
  Number(installed['major']) > EVENT_SWITCH_SINCE.major ||
  (Number(installed['major']) === EVENT_SWITCH_SINCE.major &&
    Number(installed['minor']) >= EVENT_SWITCH_SINCE.minor);

type Scene = {
  dest: string;
  globalConfig: string;
  hooksDir: string;
  log: string;
  upstream: string;
};

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
};

/** Commits an executable script at `name` that appends `name` to `log`. */
const trackScript = async (upstream: string, name: string, log: string): Promise<void> => {
  await addCommit(upstream, name, `#!/bin/sh\necho ${name} >> ${JSON.stringify(log)}\n`);
  await chmod(join(upstream, name), SCRIPT_MODE);
  await runner.run('git', ['commit', '-q', '-a', '-m', `make ${name} executable`], {
    cwd: upstream,
  });
};

/** An upstream tracking `fsm.sh` and `evil.sh`, and a global config naming both by relative path. */
const sceneWithUserCommands = async (): Promise<Scene> => {
  const scratch = await mkdtemp(join(tmpdir(), 'refs-policy-'));
  const log = join(scratch, 'ran.log');
  const { dir: upstream } = await createFixtureRepo();
  await trackScript(upstream, 'fsm.sh', log);
  await trackScript(upstream, 'evil.sh', log);
  const globalConfig = join(scratch, 'gitconfig');
  await writeFile(
    globalConfig,
    '[core]\n\tfsmonitor = ./fsm.sh\n[hook "x"]\n\tevent = post-checkout\n\tcommand = ./evil.sh\n',
  );
  await writeFile(log, '');
  const dest = join(scratch, 'checkout');
  return { dest, globalConfig, hooksDir: join(scratch, 'hooks'), log, upstream };
};

/** Clones and syncs with the scene's global config in effect, then returns what ran. */
const cloneThenUpdate = async (scene: Scene): Promise<string> => {
  const { dest, hooksDir, upstream } = scene;
  const previous = process.env['GIT_CONFIG_GLOBAL'];
  process.env['GIT_CONFIG_GLOBAL'] = scene.globalConfig;
  try {
    await cloneRepo(runner, { cloneUrl: upstream, dest, hooksDir, mode: 'full' });
    await addCommit(upstream, 'NEW.md', 'upstream moved\n');
    await syncRef(runner, { defaultBranch: 'main', dir: dest, hooksDir });
  } finally {
    restore('GIT_CONFIG_GLOBAL', previous);
  }
  return readFile(scene.log, 'utf8');
};

describe('commands named in the user configuration, relative to a checkout', SUITE_OPTS, () => {
  it('do not run the checkout’s fsmonitor script during a clone or a sync', async () => {
    expect.hasAssertions();
    const scene = await sceneWithUserCommands();

    const ran = await cloneThenUpdate(scene);

    expect(ran).not.toContain('fsm.sh');
    await expect(readFile(join(scene.dest, 'NEW.md'), 'utf8')).resolves.toBe('upstream moved\n');
  });

  it.runIf(hasEventSwitch)('do not run the checkout’s script as a configured hook', async () => {
    expect.hasAssertions();
    const scene = await sceneWithUserCommands();

    const ran = await cloneThenUpdate(scene);

    expect(ran).not.toContain('evil.sh');
  });
});
