import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { cliBundle } from '../helpers/printed-command.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const BIN = join(import.meta.dirname, '../../bin/refs.mjs');
type Fixture = { root: string; sentinel: string; url: string; env: NodeJS.ProcessEnv };

const setup = async (): Promise<Fixture> => {
  await cliBundle();
  const root = await mkdtemp(join(tmpdir(), 'refs-isolation-'));
  const upstream = await createFixtureRepo();
  const sentinel = join(root, 'sentinel');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, 'absent'),
    GIT_CONFIG_NOSYSTEM: '1',
    REFS_ALLOW_FILE_URLS: '1',
    REFS_HOME: join(root, 'home'),
    REFS_UPDATE_CHECK: '0',
  };
  await exec('git', ['clone', '-q', upstream.url, sentinel], { env });
  await exec(process.execPath, [BIN, 'init', '--json'], { env });
  return { env, root, sentinel, url: upstream.url };
};

const cli = async (args: string[], env: NodeJS.ProcessEnv) => {
  const result = await exec(process.execPath, [BIN, ...args, '--json'], { env });
  return JSON.parse(result.stdout) as { ok: boolean; data: { key: string; refs?: unknown } };
};

const sentinelBytes = (dir: string) =>
  Promise.all([
    readFile(join(dir, '.git/config')),
    readFile(join(dir, '.git/index')),
    readFile(join(dir, 'README.md')),
    readFile(join(dir, 'untracked.txt')),
  ]);

const dirtySentinel = async (dir: string): Promise<void> => {
  await writeFile(join(dir, 'README.md'), 'keep this work in progress\n');
  await writeFile(join(dir, 'untracked.txt'), 'keep this untracked file\n');
};

describe('built CLI under inherited repository variables', () => {
  it(
    'adds and syncs its checkout without modifying the caller repository or index',
    async () => {
      expect.hasAssertions();
      const fixture = await setup();
      await dirtySentinel(fixture.sentinel);
      const before = await sentinelBytes(fixture.sentinel);
      const redirected = {
        ...fixture.env,
        GIT_DIR: join(fixture.sentinel, '.git'),
        GIT_INDEX_FILE: join(fixture.sentinel, '.git/index'),
      };
      const added = await cli(
        ['add', fixture.url, '--description', 'An isolated reference.'],
        redirected,
      );
      expect(added.ok).toBe(true);
      const synced = await cli(['sync', added.data.key], {
        ...redirected,
        GIT_WORK_TREE: fixture.sentinel,
      });
      expect(synced.ok).toBe(true);
      await expect(sentinelBytes(fixture.sentinel)).resolves.toStrictEqual(before);
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'keeps inherited command-scope URL rewrites usable',
    async () => {
      expect.hasAssertions();
      const fixture = await setup();
      const added = await cli(['add', 'https://example.invalid/fixture/repo', '--dry-run'], {
        ...fixture.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${fixture.url}.insteadOf`,
        GIT_CONFIG_VALUE_0: 'https://example.invalid/fixture/repo',
      });
      expect(added.ok).toBe(true);
      expect(JSON.stringify(added.data)).toContain('example.invalid/fixture/repo');
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('an inherited index without a repository override', () => {
  it(
    'does not replace the caller index during clone or sync',
    async () => {
      expect.hasAssertions();
      const fixture = await setup();
      const index = join(fixture.sentinel, '.git/index');
      const before = await readFile(index);
      const env = { ...fixture.env, GIT_INDEX_FILE: index };
      const added = await cli(['add', fixture.url, '--description', 'An isolated index.'], env);
      expect(added.ok).toBe(true);
      const synced = await cli(['sync', added.data.key], env);
      expect(synced.ok).toBe(true);
      await expect(readFile(index)).resolves.toStrictEqual(before);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
