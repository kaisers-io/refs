import { checkoutPath, readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { access } from 'node:fs/promises';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// `remove.test.ts` proves the full prune (empty parents removed up to sources/); this file pins
// the other half of `pruneEmptyParents`' contract: the upward walk must STOP at the first parent
// that still has entries — removing one of two sibling refs under the same owner directory must
// never touch the sibling's checkout or the shared ancestors. In its own file because
// `remove.test.ts` has no headroom left under the repo's 300-line oxlint cap.

const REMOVED_KEY = 'github.com/vercel/next.js';
const SIBLING_KEY = 'github.com/vercel/turbo';

const entryFor = (key: string, description: string): Record<string, unknown> => ({
  default_branch: 'main',
  description,
  tag_format: 'v{version}',
  url: `https://${key}`,
});

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

type SiblingsFixture = {
  ctx: ReturnType<typeof testContext>['ctx'];
  home: ReturnType<typeof resolveHome>;
  removedDest: string;
  siblingDest: string;
};

const setupSiblings = async (homeDir: string): Promise<SiblingsFixture> => {
  const { ctx } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedConfig(home, {
    [REMOVED_KEY]: entryFor(REMOVED_KEY, 'The removed sibling.'),
    [SIBLING_KEY]: entryFor(SIBLING_KEY, 'The surviving sibling.'),
  });
  const removedDest = checkoutPath(home, zRefKey.parse(REMOVED_KEY));
  const siblingDest = checkoutPath(home, zRefKey.parse(SIBLING_KEY));
  await markCheckoutPresent(removedDest);
  await markCheckoutPresent(siblingDest);
  return { ctx, home, removedDest, siblingDest };
};

describe('refs remove: prune stops at a non-empty parent', () => {
  it('removes one sibling but leaves the other checkout and the shared parents intact', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, removedDest, siblingDest } = await setupSiblings(homeDir);

        await run(ctx, ['node', 'refs', 'remove', REMOVED_KEY, '--json']);

        await expect(pathExists(removedDest)).resolves.toBe(false);
        await expect(pathExists(siblingDest)).resolves.toBe(true);
        const config = await readConfig(home);
        expect(config.refs[REMOVED_KEY]).toBeUndefined();
        expect(config.refs[SIBLING_KEY]).toBeDefined();
      }),
    );
  });
});
