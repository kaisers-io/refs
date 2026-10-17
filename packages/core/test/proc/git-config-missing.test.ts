import { describe, expect, it } from 'vitest';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { rawGit, readFixture, withFixture } from './git-config-graph-fixture.ts';
import { join } from 'node:path';

const FAILURE = 'Git configuration cannot be safely inventoried';
const include = (path: string): string => `[include]\npath=${JSON.stringify(path)}\n`;

const conditional = (condition: string, path: string): string =>
  `[includeIf ${JSON.stringify(condition)}]\npath=${JSON.stringify(path)}\n`;

describe('missing Git configuration includes', () => {
  it('matches Git for a missing external include while retaining real entries', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const missing = join(await realpath(fixture.home), 'absent', 'config');
      await writeFile(fixture.config, `${include(missing)}[user]\nname=fixture\n`);
      const actual = await rawGit(fixture.cwd, fixture.env)(['config', '--get', 'user.name']);
      expect(actual).toMatchObject({ exitCode: 0, stdout: 'fixture\n' });
      const entries = await readFixture(fixture);
      expect(entries).toContainEqual(
        expect.objectContaining({ key: 'user.name', value: 'fixture' }),
      );
    });
  });

  it('inventories actions/checkout credentials alongside inactive container includes', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const initialized = await rawGit(fixture.cwd, fixture.env)(['init', '-q']);
      expect(initialized.exitCode).toBe(0);
      const credentials = join(await realpath(fixture.home), 'credentials.config');
      await writeFile(credentials, '[http "https://fixture.invalid/"]\nextraheader=fixture-only\n');
      await writeFile(
        join(fixture.cwd, '.git', 'config'),
        conditional(`gitdir:${fixture.cwd.replaceAll('\\', '/')}/.git`, credentials) +
          conditional(
            'gitdir:/github/workspace/.git',
            '/github/runner_temp/fixture-credentials.config',
          ) +
          conditional(
            'gitdir:/github/workspace/.git/worktrees/*',
            '/github/runner_temp/fixture-credentials.config',
          ),
      );
      const entries = await readFixture(fixture);
      expect(entries).toContainEqual(
        expect.objectContaining({
          key: 'http.https://fixture.invalid/.extraheader',
          value: 'fixture-only',
        }),
      );
    });
  });
});

describe('unsafe missing Git configuration includes', () => {
  it('refuses a missing include that checkout could create', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const future = join(fixture.root, 'future');
      await writeFile(fixture.config, conditional('onbranch:inactive', join(future, 'config')));
      await expect(readFixture(fixture, { protectedRoots: [future] })).rejects.toThrow(FAILURE);
    });
  });

  it('refuses unresolved parent components that a future symlink could redirect', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const path = `${fixture.cwd}/missing/../../external/config`;
      await writeFile(fixture.config, conditional('onbranch:inactive', path));
      await expect(readFixture(fixture, { protectedRoots: [fixture.cwd] })).rejects.toThrow(
        FAILURE,
      );
    });
  });

  it('allows missing paths through existing trusted aliases such as macOS temporary prefixes', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const external = join(fixture.root, 'external');
      await mkdir(external);
      await symlink(external, join(fixture.home, 'alias'), 'junction');
      await writeFile(fixture.config, include(join(fixture.home, 'alias', 'missing')));
      await expect(readFixture(fixture)).resolves.toContainEqual(
        expect.objectContaining({ key: 'include.path' }),
      );
    });
  });
});
