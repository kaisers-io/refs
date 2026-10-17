import { describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { readFixture, withFixture } from './git-config-graph-fixture.ts';
import type { Fixture } from './git-config-graph-fixture.ts';
import { join } from 'node:path';

const FAILURE = 'Git configuration cannot be safely inventoried';
const include = (path: string): string => `[include]\npath=${JSON.stringify(path)}\n`;

const aliasFixture = async (fixture: Fixture) => {
  const outside = join(fixture.home, 'outside');
  const tracked = join(fixture.cwd, 'tracked-link');
  const alias = join(fixture.home, 'alias');
  await mkdir(outside);
  await writeFile(join(outside, 'config'), '[user]\nname=fixture\n');
  await symlink(outside, tracked, 'junction');
  await symlink(tracked, alias, 'junction');
  return { alias, tracked };
};

describe('existing configuration alias provenance', () => {
  it('refuses external includes passing through a protected link to an existing external config', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const { alias } = await aliasFixture(fixture);
      await writeFile(fixture.config, include(join(alias, 'config')));
      await expect(readFixture(fixture, { protectedRoots: [fixture.cwd] })).rejects.toThrow(
        FAILURE,
      );
    });
  });

  it('refuses an existing external config reached through a tracked path', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const { tracked } = await aliasFixture(fixture);
      await writeFile(fixture.config, include(join(tracked, 'config')));
      await expect(readFixture(fixture, { protectedRoots: [fixture.cwd] })).rejects.toThrow(
        FAILURE,
      );
    });
  });

  it('refuses an existing global root reached through a protected intermediate link', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const { alias } = await aliasFixture(fixture);
      fixture.env['GIT_CONFIG_GLOBAL'] = join(alias, 'config');
      await expect(readFixture(fixture, { protectedRoots: [fixture.cwd] })).rejects.toThrow(
        FAILURE,
      );
    });
  });
});
