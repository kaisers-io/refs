import { describe, expect, it } from 'vitest';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { missingProtectionRoots } from '../../src/proc/git-path-protection.ts';
import { withFixture } from './git-config-graph-fixture.ts';

const FAILURE = 'Git configuration cannot be safely inventoried';

describe('future protected filesystem aliases', () => {
  it.each(['darwin', 'win32'] as const)(
    'uses an existing canonical ancestor for %s instead of guessing aliases',
    async (platform) => {
      expect.hasAssertions();
      await withFixture(async (fixture) => {
        const parent = await realpath(fixture.cwd);
        await expect(
          missingProtectionRoots([join(parent, 'Futuré', 'child')], platform),
        ).resolves.toStrictEqual([parent]);
        await expect(missingProtectionRoots([parent], platform)).resolves.toStrictEqual([parent]);
        await expect(
          missingProtectionRoots([join(parent, 'Future')], 'linux'),
        ).resolves.toStrictEqual([join(parent, 'Future')]);
      });
    },
  );

  it('canonicalizes trusted aliases but refuses dangling protected aliases', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const outside = join(fixture.root, 'outside');
      const alias = join(fixture.root, 'alias');
      await mkdir(outside);
      await symlink(outside, alias, 'junction');
      await expect(
        missingProtectionRoots([join(alias, 'future')], 'darwin'),
      ).resolves.toStrictEqual([await realpath(outside)]);
      const dangling = join(fixture.root, 'dangling');
      await symlink(join(fixture.root, 'absent'), dangling, 'junction');
      await expect(missingProtectionRoots([dangling], 'darwin')).rejects.toThrow(FAILURE);
    });
  });
});
