import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const runner = new SpawnRunner();
const MODE = 0o755;
const { stdout: version } = await exec('git', ['--version']);
const git254 = /\b2\.54\./u.test(version);
const git255 = /\b2\.55\./u.test(version);
const unsupported = process.platform === 'win32' || (!git254 && !git255);

const trackedHook = async (source: string, marker: string): Promise<void> => {
  const hook = join(source, 'fixture-hook.sh');
  await writeFile(hook, `#!/bin/sh\nprintf ran >> '${marker}'\n`);
  await chmod(hook, MODE);
  await exec('git', ['add', 'fixture-hook.sh'], { cwd: source });
  await exec('git', ['commit', '-q', '-m', 'test hook content'], { cwd: source });
};

const configText = (collision: boolean): string => {
  const events = ['post-checkout', 'reference-transaction', 'post-index-change'];
  const hooks = events
    .map(
      (event) =>
        `[hook "fixture-${event}"]\n event = ${event}\n command = test ! -f ./fixture-hook.sh || ./fixture-hook.sh\n`,
    )
    .join('');
  const unusual = ['', 'a.b', 'a=b', 'carriage\rreturn', 'paragraph\u2029separator']
    .map((label) => `[hook "${label}"]\n event = post-checkout\n command = ./fixture-hook.sh\n`)
    .join('');
  return collision
    ? `${hooks}${unusual}[hook "post-checkout"]\n command =\n`
    : `${hooks}${unusual}`;
};

const prepareScenario = async (collision: boolean) => {
  const source = await createFixtureRepo();
  const root = await mkdtemp(join(tmpdir(), 'refs-configured-hooks-'));
  onTestFinished(async () => {
    await Promise.all([root, source.dir].map((path) => rm(path, { force: true, recursive: true })));
  });
  const dest = join(root, 'checkout');
  const marker = join(root, 'marker');
  const config = join(root, 'config');
  await trackedHook(source.dir, marker);
  await writeFile(join(root, 'conditional'), configText(collision));
  await writeFile(
    config,
    `[includeIf "gitdir:${dest.replaceAll('\\', '/')}/.git"]\n path = ./conditional\n`,
  );
  return { config, dest, hooksDir: join(root, 'hooks'), marker, source };
};

const scenario = async (collision: boolean): Promise<string> => {
  const { config, dest, hooksDir, marker, source } = await prepareScenario(collision);
  vi.stubEnv('GIT_CONFIG_GLOBAL', config);
  try {
    await cloneRepo(runner, { cloneUrl: source.url, dest, hooksDir, mode: 'full' });
    await syncRef(runner, { defaultBranch: 'main', dir: dest, hooksDir });
  } finally {
    vi.unstubAllEnvs();
  }
  return marker;
};

// The matrix is run against real 2.54 and 2.55 binaries: one lacks event switches, while the
// other permits an event/friendly-name collision. Per-friendly-name inventory covers both.
describe.skipIf(unsupported)('configured hooks on git 2.54 and 2.55', () => {
  it.each([false, true])(
    'blocks destination-specific hooks, including event-name collision=%s',
    async (collision) => {
      expect.hasAssertions();
      const marker = await scenario(collision);
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
