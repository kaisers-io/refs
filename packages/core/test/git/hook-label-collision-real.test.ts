import { addCommit, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// Git 2.55 reads `hook.<name>.enabled=false` as the switch for EVENT <name> only while no hook
// LABEL is called <name>: a label is any name with a `command`, `event` or `parallel` key
// (`is_friendly_name()` in hook.c). `[hook "post-checkout"] command = …` therefore turns refs'
// `hook.post-checkout.enabled=false` into "disable that one label", and every other label on the
// event still runs. The label that does the damage need not even sit in an active section: an
// `includeIf "hasconfig:remote.*.url:…"` file is applied inside the clone, after any listing
// taken beforehand. Measured on git 2.55.0 with the event switches alone: labels `x` and `y` ran.

const runner = new SpawnRunner();
const SUITE_OPTS = { timeout: SLOW_IO_TIMEOUT_MS };
const VERSION = /(?<major>\d+)\.(?<minor>\d+)/u;
const LABELS_SINCE = { major: 2, minor: 55 };

const plainGit = promisify(execFile);
const { stdout: version } = await plainGit('git', ['--version']);
const installed = VERSION.exec(version)?.groups;
const major = Number(installed?.['major']);
const hasLabelSwitch =
  major > LABELS_SINCE.major ||
  (major === LABELS_SINCE.major && Number(installed?.['minor']) >= LABELS_SINCE.minor);

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
};

// An active colliding label plus a label on the same event, and the same shape again for
// `reference-transaction` in a `hasconfig` include that only matches once the clone has a remote.
// Each hook only logs its own name, by absolute path: any line in the log is a configured hook
// that ran, whatever it would have run in a real configuration (a script the checkout tracks).
const collidingHooks = (event: string, label: string, log: string): string =>
  `[hook "${event}"]\n\tcommand = echo ${event} >> '${log}'\n` +
  `[hook "${label}"]\n\tevent = ${event}\n\tcommand = echo ${label} >> '${log}'\n`;

type Scene = {
  dest: string;
  globalConfig: string;
  hooksDir: string;
  log: string;
  upstream: string;
};

const scene = async (): Promise<Scene> => {
  const scratch = await mkdtemp(join(tmpdir(), 'refs-hook-labels-'));
  const log = join(scratch, 'ran.log');
  const { dir: upstream } = await createFixtureRepo();
  await mkdir(join(scratch, 'conf'));
  const included = join(scratch, 'conf', 'remote-only.gitconfig');
  await writeFile(included, collidingHooks('reference-transaction', 'y', log));
  const globalConfig = join(scratch, 'gitconfig');
  await writeFile(
    globalConfig,
    `${collidingHooks('post-checkout', 'x', log)}[includeIf "hasconfig:remote.*.url:**"]\n\tpath = conf/remote-only.gitconfig\n`,
  );
  await writeFile(log, '');
  return {
    dest: join(scratch, 'checkout'),
    globalConfig,
    hooksDir: join(scratch, 'hooks'),
    log,
    upstream,
  };
};

const withGlobal = async <Result>(config: string, body: () => Promise<Result>): Promise<Result> => {
  const previous = process.env['GIT_CONFIG_GLOBAL'];
  process.env['GIT_CONFIG_GLOBAL'] = config;
  try {
    return await body();
  } finally {
    restore('GIT_CONFIG_GLOBAL', previous);
  }
};

describe.runIf(hasLabelSwitch)('a configured hook label named after an event', SUITE_OPTS, () => {
  it('does not let another label on that event run during refs’ clone and sync', async () => {
    expect.hasAssertions();
    const { dest, globalConfig, hooksDir, log, upstream } = await scene();

    await withGlobal(globalConfig, async () => {
      await cloneRepo(runner, { cloneUrl: upstream, dest, hooksDir, mode: 'full' });
      await addCommit(upstream, 'NEW.md', 'upstream moved\n');
      await syncRef(runner, { defaultBranch: 'main', dir: dest, hooksDir });
    });

    await expect(readFile(log, 'utf8')).resolves.toBe('');
    await expect(readFile(join(dest, 'NEW.md'), 'utf8')).resolves.toBe('upstream moved\n');
  });

  it('is live: plain git with only the event switches still runs the other labels', async () => {
    expect.hasAssertions();
    const { dest, globalConfig, log, upstream } = await scene();
    const switches = ['post-checkout', 'reference-transaction'].flatMap((event) => [
      '-c',
      `hook.${event}.enabled=false`,
    ]);

    await plainGit('git', [...switches, 'clone', '-q', upstream, dest], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig },
    });

    const ran = await readFile(log, 'utf8');
    expect(ran).toMatch(/^x /mu);
    expect(ran).toMatch(/^y /mu);
  });
});
