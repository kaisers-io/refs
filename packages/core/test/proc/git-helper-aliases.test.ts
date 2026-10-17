import { assertGitHelpers, assertGitSearchPaths } from '../../src/proc/git-helper-policy.ts';
import { describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import type { Fixture } from './git-config-graph-fixture.ts';
import { join } from 'node:path';
import { withFixture } from './git-config-graph-fixture.ts';

const REFUSAL = /use trusted external helpers/u;
const prepareAlias = async (fixture: Fixture): Promise<string> => {
  const outside = join(fixture.home, 'outside');
  const tracked = join(fixture.cwd, 'tracked-link');
  const alias = join(fixture.home, 'alias');
  await mkdir(outside);
  await writeFile(join(outside, 'helper'), 'fixture, never executed');
  await symlink(outside, tracked, 'junction');
  await symlink(tracked, alias, 'junction');
  return alias;
};

describe('helper paths through mutable reference aliases', () => {
  it('refuses PATH through a tracked intermediate link even when its final target is external', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const alias = await prepareAlias(fixture);
      await expect(
        assertGitSearchPaths({ env: { PATH: alias }, roots: [fixture.cwd] }),
      ).rejects.toThrow(REFUSAL);
    });
  });

  it('refuses askpass through a tracked intermediate link', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const alias = await prepareAlias(fixture);
      await expect(
        assertGitHelpers([], { env: { GIT_ASKPASS: join(alias, 'helper') }, roots: [fixture.cwd] }),
      ).rejects.toThrow(REFUSAL);
    });
  });

  it('refuses configured helper arguments through a tracked intermediate link', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const alias = await prepareAlias(fixture);
      const entry = {
        key: 'credential.helper',
        origin: 'command line:',
        value: `!"${join(alias, 'helper').replaceAll('\\', '/')}"`,
      };
      await expect(assertGitHelpers([entry], { env: {}, roots: [fixture.cwd] })).rejects.toThrow(
        REFUSAL,
      );
    });
  });
});
