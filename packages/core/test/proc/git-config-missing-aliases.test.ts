import { describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { readFixture, withFixture } from './git-config-graph-fixture.ts';
import { join } from 'node:path';

const FAILURE = 'Git configuration cannot be safely inventoried';
const include = (path: string): string => `[include]\npath=${JSON.stringify(path)}\n`;

describe('missing configuration alias provenance', () => {
  it('refuses external aliases passing through a protected symlink to an external target', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const outside = join(fixture.home, 'outside');
      const trackedLink = join(fixture.cwd, 'tracked-link');
      const alias = join(fixture.home, 'alias');
      await mkdir(outside);
      await symlink(outside, trackedLink, 'junction');
      await symlink(trackedLink, alias, 'junction');
      await writeFile(fixture.config, include(join(alias, 'missing')));
      await expect(readFixture(fixture, { protectedRoots: [fixture.cwd] })).rejects.toThrow(
        FAILURE,
      );
    });
  });

  it('refuses dangling aliases even when the prospective target is external', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const alias = join(fixture.home, 'alias');
      await symlink(join(fixture.home, 'missing-directory'), alias, 'junction');
      await writeFile(fixture.config, include(join(alias, 'config')));
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });

  it('refuses missing includes beneath non-directory prefixes', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const file = join(fixture.home, 'file');
      await writeFile(file, 'fixture');
      await writeFile(fixture.config, include(join(file, 'config')));
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });
});

describe('missing configuration root provenance', () => {
  it('refuses a missing global root with unresolved parent components under a future checkout', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      fixture.env['GIT_CONFIG_GLOBAL'] = `${fixture.cwd}/missing/../../external/config`;
      await expect(readFixture(fixture, { protectedRoots: [fixture.cwd] })).rejects.toThrow(
        FAILURE,
      );
    });
  });

  it('allows a missing global root through a trusted external directory alias', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const alias = join(fixture.root, 'alias');
      await symlink(fixture.home, alias, 'junction');
      fixture.env['GIT_CONFIG_GLOBAL'] = join(alias, 'absent');
      await expect(readFixture(fixture)).resolves.toStrictEqual([]);
    });
  });
});

describe('missing configuration alias bounds', () => {
  it('refuses alias chains beyond the inspection bound', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const count = 33;
      await Promise.all(
        Array.from({ length: count - 1 }, (_unused, index) =>
          symlink(
            join(fixture.home, String(index + 1)),
            join(fixture.home, String(index)),
            'junction',
          ),
        ),
      );
      await symlink(fixture.cwd, join(fixture.home, String(count - 1)), 'junction');
      await writeFile(fixture.config, include(join(fixture.home, '0', 'missing')));
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });
});
