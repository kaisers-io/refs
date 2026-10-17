import { describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { rawGit, readFixture, withFixture } from './git-config-graph-fixture.ts';
import { assertGitSearchPaths } from '../../src/proc/git-helper-policy.ts';
import { join } from 'node:path';

// Exercise the conservative future-alias branch on every CI platform, using real filesystem
// lookup. This does not pretend to emulate native case folding or Windows short-name creation.
vi.mock(import('../../src/proc/git-path-protection.ts'), async (original) => {
  const actual = await original();
  return {
    missingProtectionRoots: (roots: readonly string[]) =>
      actual.missingProtectionRoots(roots, 'darwin'),
  };
});

const FAILURE = 'Git configuration cannot be safely inventoried';

describe('owned Git policy roots', () => {
  it('allows absent external search paths once the protected sources root exists', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const sources = join(fixture.root, 'future-home', 'sources');
      const context = { env: { PATH: join(fixture.root, 'absent-tools') }, roots: [sources] };
      await expect(assertGitSearchPaths(context)).rejects.toThrow('use trusted external helpers');
      await mkdir(sources, { recursive: true });
      await expect(assertGitSearchPaths(context)).resolves.toBeUndefined();
    });
  });

  it('accepts actual metadata through a trusted worktree ancestor alias', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await expect(rawGit(fixture.cwd, fixture.env)(['init', '-q'])).resolves.toMatchObject({
        exitCode: 0,
      });
      const alias = join(fixture.home, 'work-alias');
      await symlink(fixture.cwd, alias, 'junction');
      await expect(readFixture(fixture, { cwd: alias })).resolves.toContainEqual(
        expect.objectContaining({ key: 'core.repositoryformatversion', value: '0' }),
      );
    });
  });

  it('still refuses metadata redirected into a tracked file through that worktree alias', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await expect(rawGit(fixture.cwd, fixture.env)(['init', '-q'])).resolves.toMatchObject({
        exitCode: 0,
      });
      const metadata = join(fixture.cwd, '.git', 'config');
      const tracked = join(fixture.cwd, 'tracked-config');
      await writeFile(tracked, await readFile(metadata));
      await rm(metadata);
      await symlink(tracked, metadata);
      const alias = join(fixture.home, 'work-alias');
      await symlink(fixture.cwd, alias, 'junction');
      await expect(readFixture(fixture, { cwd: alias })).rejects.toThrow(FAILURE);
    });
  });
});
