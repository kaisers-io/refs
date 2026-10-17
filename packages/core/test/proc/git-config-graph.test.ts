import { describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { prepareInvalid, rawGit, readFixture, withFixture } from './git-config-graph-fixture.ts';
import { join } from 'node:path';

const DUPLICATE_INCLUDE_COUNT = 2;
const FAILURE = 'Git configuration cannot be safely inventoried';
const CONDITIONS = [
  'gitdir:/not-yet-created/',
  'onbranch:not-yet-created',
  'hasconfig:remote.*.url:https://example.invalid/**',
];

const include = (path: string): string => `[include]\npath = ${JSON.stringify(path)}\n`;

describe('git configuration condition', () => {
  it('inventories inactive conditions, relative and home paths, and repeated shared includes', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const nested = join(fixture.home, 'nested');
      await mkdir(nested);
      await writeFile(
        join(fixture.home, 'shared'),
        '[hook "name=é"]\ncommand=never-run\nevent=post-checkout\n',
      );
      await writeFile(join(nested, 'first'), include('../shared') + include('~/shared'));
      await writeFile(
        fixture.config,
        CONDITIONS.map((condition) => `[includeIf "${condition}"]\npath=nested/first\n`).join(''),
      );
      const entries = await readFixture(fixture);
      expect(entries.filter(({ key }) => key === 'hook.name=é.command')).toHaveLength(
        CONDITIONS.length * DUPLICATE_INCLUDE_COUNT,
      );
      expect(entries.filter(({ key }) => key.startsWith('includeif.'))).toHaveLength(
        CONDITIONS.length,
      );
    });
  });
});

describe('git configuration auth', () => {
  it('keeps credential, proxy, URL rewrite and command-injected configuration intact', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await writeFile(
        fixture.config,
        '[credential "https://example.invalid"]\nhelper = !/trusted/helper auth\n[http]\nproxy=http://proxy.invalid\n[url "https://example.invalid/"]\ninsteadOf=synthetic:\n',
      );
      Object.assign(fixture.env, {
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'include.path',
        GIT_CONFIG_KEY_1: 'credential.username',
        GIT_CONFIG_VALUE_0: join(fixture.home, 'extra'),
        GIT_CONFIG_VALUE_1: 'synthetic',
      });
      await writeFile(join(fixture.home, 'extra'), '[hook "injected"]\ncommand=never-run\n');
      const entries = await readFixture(fixture);
      expect(entries).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'credential.https://example.invalid.helper',
            value: '!/trusted/helper auth',
          }),
          expect.objectContaining({ key: 'http.proxy', value: 'http://proxy.invalid' }),
          expect.objectContaining({
            key: 'url.https://example.invalid/.insteadof',
            value: 'synthetic:',
          }),
          expect.objectContaining({
            key: 'credential.username',
            origin: 'command line:',
            value: 'synthetic',
          }),
          expect.objectContaining({ key: 'hook.injected.command' }),
        ]),
      );
    });
  });
});

describe('git configuration origin', () => {
  it('resolves root-relative origins when invoked from a repository subdirectory', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const initialized = await rawGit(fixture.cwd, fixture.env)(['init', '-q']);
      expect(initialized.exitCode).toBe(0);
      const nested = join(fixture.cwd, 'nested');
      await mkdir(nested);
      const entries = await readFixture(fixture, { cwd: nested });
      expect(entries).toStrictEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'core.repositoryformatversion' })]),
      );
    });
  });
});

describe('git configuration trackedInclude', () => {
  it('refuses tracked includes even in an inactive conditional', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const initialized = await rawGit(fixture.cwd, fixture.env)(['init', '-q']);
      expect(initialized.exitCode).toBe(0);
      await writeFile(
        join(fixture.cwd, 'tracked-config'),
        '[hook "untrusted"]\ncommand=never-run\n',
      );
      await writeFile(
        fixture.config,
        `[includeIf "onbranch:inactive"]\npath=${join(fixture.cwd, 'tracked-config')}\n`,
      );
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });
});

describe('git configuration symlink', () => {
  it('refuses external symlinks into protected checkout content', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await writeFile(join(fixture.cwd, 'tracked-config'), '[user]\nname=untrusted\n');
      await symlink(join(fixture.cwd, 'tracked-config'), join(fixture.home, 'external'));
      await writeFile(fixture.config, include('external'));
      await expect(readFixture(fixture, { protectedRoots: [fixture.cwd] })).rejects.toThrow(
        FAILURE,
      );
    });
  });
});

describe('git configuration invalid', () => {
  it.each(['directory', 'cycle', 'nonutf8', 'implicit', 'relative-env'])(
    'refuses unverifiable %s without exposing configuration values',
    async (kind) => {
      expect.hasAssertions();
      await withFixture(async (fixture) => {
        await prepareInvalid(fixture, kind);
        await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
      });
    },
  );
});
