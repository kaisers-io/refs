import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { rawGit, readFixture, withFixture } from './git-config-graph-fixture.ts';
import type { Fixture } from './git-config-graph-fixture.ts';

const FAILURE = 'Git configuration cannot be safely inventoried';

describe('configuration roots before clone', () => {
  it.each(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'HOME', 'XDG_CONFIG_HOME'])(
    'rejects an absent %s rooted in the prospective checkout',
    async (variable) => {
      expect.hasAssertions();
      await withFixture(async (fixture) => {
        const future = join(fixture.root, 'future');
        delete fixture.env['GIT_CONFIG_GLOBAL'];
        fixture.env[variable] = join(future, 'not-created');
        await expect(readFixture(fixture, { protectedRoots: [future] })).rejects.toThrow(FAILURE);
      });
    },
  );

  it('allows a missing trusted external global config', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      fixture.env['GIT_CONFIG_GLOBAL'] = join(fixture.home, 'absent');
      await expect(readFixture(fixture)).resolves.toStrictEqual([]);
    });
  });

  it('refuses relative roots whose meaning can change during clone', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      fixture.env['GIT_CONFIG_GLOBAL'] = relative(fixture.cwd, fixture.config);
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });
});

describe('configuration path containment', () => {
  it('refuses dangling global symlinks into a future checkout', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const future = join(fixture.root, 'future');
      const redirect = join(fixture.home, 'redirect');
      await symlink(join(future, 'config'), redirect);
      fixture.env['GIT_CONFIG_GLOBAL'] = redirect;
      await expect(readFixture(fixture, { protectedRoots: [future] })).rejects.toThrow(FAILURE);
    });
  });

  it('follows existing symlink ancestors when protecting a future destination', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const target = join(fixture.root, 'target');
      await mkdir(target);
      await symlink(target, join(fixture.root, 'alias'));
      fixture.env['GIT_CONFIG_GLOBAL'] = join(target, 'future', 'config');
      await expect(
        readFixture(fixture, { protectedRoots: [join(fixture.root, 'alias', 'future')] }),
      ).rejects.toThrow(FAILURE);
    });
  });

  it('refuses root repository metadata redirected into tracked content', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const initialized = await rawGit(fixture.cwd, fixture.env)(['init', '-q']);
      expect(initialized.exitCode).toBe(0);
      await writeFile(
        join(fixture.cwd, 'tracked-config'),
        '[core]\nrepositoryformatversion=0\nbare=false\n',
      );
      await rm(join(fixture.cwd, '.git', 'config'));
      await symlink(join(fixture.cwd, 'tracked-config'), join(fixture.cwd, '.git', 'config'));
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });
});

const LAST_RECORD = -1;
const NATIVE_SELECTED =
  process.platform === 'win32'
    ? { key: 'user.name', value: 'decoy' }
    : { key: 'hook.actual.command', value: 'never-run' };

const prepareLexicalIncludes = async (fixture: Fixture): Promise<void> => {
  const outside = join(fixture.root, 'outside');
  await mkdir(join(outside, 'child'), { recursive: true });
  await symlink(join(outside, 'child'), join(fixture.home, 'alias'));
  await writeFile(join(outside, 'child', 'config'), '[include]\npath=../selected\n');
  await writeFile(join(outside, 'selected'), '[hook "actual"]\ncommand=never-run\n');
  await writeFile(join(fixture.home, 'selected'), '[user]\nname=decoy\n');
  await writeFile(fixture.config, '[include]\npath=alias/config\n');
};

describe('lexical include paths', () => {
  it('matches native Git for symlink followed by parent-directory semantics', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await prepareLexicalIncludes(fixture);
      const entries = await readFixture(fixture);
      const actual = await rawGit(
        fixture.cwd,
        fixture.env,
      )(['config', '--includes', '--null', '--list']);
      expect(actual.exitCode).toBe(0);
      const expected = actual.stdout
        .split('\0')
        .slice(0, LAST_RECORD)
        .map((record) => {
          const delimiter = record.indexOf('\n');
          return { key: record.slice(0, delimiter), value: record.slice(delimiter + 1) };
        });
      expect(entries.map(({ key, value }) => ({ key, value }))).toStrictEqual(expected);
      // Win32 normalizes '..' before traversing the junction; POSIX follows the symlink first.
      expect(expected).toContainEqual(NATIVE_SELECTED);
    });
  });
});
