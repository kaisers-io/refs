import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { describe, expect, it, onTestFinished } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { cliBundle } from '../helpers/printed-command.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const BIN = join(import.meta.dirname, '../../bin/refs.mjs');
const ENCODING = 'utf8';

const conditional = (condition: string, path: string): string =>
  `[includeIf ${JSON.stringify(condition)}]\npath=${JSON.stringify(path)}\n`;

const setup = async () => {
  await cliBundle();
  const temporary = await mkdtemp(join(tmpdir(), 'refs-ci-config-'));
  const root = await realpath(temporary);
  const source = await createFixtureRepo();
  onTestFinished(async () => {
    await Promise.all([root, source.dir].map((path) => rm(path, { force: true, recursive: true })));
  });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, 'absent'),
    GIT_CONFIG_NOSYSTEM: '1',
    REFS_ALLOW_FILE_URLS: '1',
    REFS_HOME: join(root, 'home'),
    REFS_UPDATE_CHECK: '0',
  };
  const caller = join(root, 'caller');
  await exec('git', ['init', '-q', caller], { env });
  return { caller, env, root, source };
};

type Fixture = Awaited<ReturnType<typeof setup>>;

const checkoutConfig = async (fixture: Fixture): Promise<void> => {
  const credentials = join(fixture.root, 'fixture-credentials.config');
  await writeFile(credentials, '[http "https://fixture.invalid/"]\nextraheader=fixture-only\n');
  await appendFile(
    join(fixture.caller, '.git', 'config'),
    conditional(`gitdir:${fixture.caller.replaceAll('\\', '/')}/.git`, credentials) +
      conditional(
        'gitdir:/github/workspace/.git',
        '/github/runner_temp/fixture-credentials.config',
      ) +
      conditional(
        'gitdir:/github/workspace/.git/worktrees/*',
        '/github/runner_temp/fixture-credentials.config',
      ),
  );
};

const cli = async (fixture: Fixture, args: string[]) => {
  const result = await exec(process.execPath, [BIN, ...args, '--json'], {
    cwd: fixture.caller,
    env: fixture.env,
  });
  return JSON.parse(result.stdout) as { ok: boolean; data: { key: string; local_path: string } };
};

const runLifecycle = async (fixture: Fixture): Promise<void> => {
  await cli(fixture, ['init']);
  const added = await cli(fixture, [
    'add',
    fixture.source.url,
    '--description',
    'A fixture reference.',
  ]);
  expect(added.ok).toBe(true);
  const resolved = await cli(fixture, ['resolve', added.data.key]);
  expect(resolved.ok).toBe(true);
  await expect(readFile(join(resolved.data.local_path, 'README.md'), ENCODING)).resolves.toBe(
    '# fixture repo\n',
  );
  await expect(cli(fixture, ['sync', added.data.key])).resolves.toMatchObject({ ok: true });
  await expect(cli(fixture, ['remove', added.data.key])).resolves.toMatchObject({ ok: true });
};

describe('built CLI with actions/checkout configuration', () => {
  it(
    'adds, resolves, syncs and removes a fresh file clone with inactive container includes',
    async () => {
      expect.hasAssertions();
      const fixture = await setup();
      await checkoutConfig(fixture);
      const before = await readFile(join(fixture.caller, '.git', 'config'));
      await runLifecycle(fixture);
      await expect(readFile(join(fixture.caller, '.git', 'config'))).resolves.toStrictEqual(before);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('first use without user Git configuration', () => {
  it(
    'creates a fresh refs home and clone without treating missing sibling user configs as source',
    async () => {
      expect.hasAssertions();
      const fixture = await setup();
      const home = join(fixture.root, 'user-home');
      await mkdir(home);
      Object.assign(fixture.env, {
        GIT_CONFIG_GLOBAL: undefined,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
      });
      await expect(stat(fixture.env.REFS_HOME)).rejects.toMatchObject({ code: 'ENOENT' });
      await runLifecycle(fixture);
      await expect(stat(join(home, '.gitconfig'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(home, '.config', 'git', 'config'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
