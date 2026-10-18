import { checkoutPath, readConfig, resolveHome, withLock, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { access } from 'node:fs/promises';
import { refLockName } from '../../src/commands/add-source.ts';
import { run } from '../../src/main.ts';
import { setTimeout } from 'node:timers/promises';
import { testContext } from '../helpers/context.ts';

// `refs remove` deletes a checkout under that ref's lock. While another process holds the lock (a
// `refs sync` fetching into the checkout), remove must wait: nothing deleted, nothing unregistered,
// until the holder lets go. The holder here is the real lock, taken through the same `withLock`.

const KEY = 'github.com/vercel/next.js';
const ENTRY = {
  default_branch: 'canary',
  description: 'The React Framework',
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};
// Long next to a remove that does not wait (a few milliseconds), short next to the lock's timeout.
const HELD_MS = 600;

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

type Snapshot = { checkout: boolean; registered: boolean };
type Scene = {
  home: ReturnType<typeof resolveHome>;
  remove: () => Promise<void>;
  snapshot: () => Promise<Snapshot>;
};

const sceneIn = async (homeDir: string): Promise<Scene> => {
  const { ctx } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedConfig(home, { [KEY]: ENTRY });
  const dest = checkoutPath(home, zRefKey.parse(KEY));
  await markCheckoutPresent(dest);
  const snapshot = async (): Promise<Snapshot> => {
    const config = await readConfig(home);
    return { checkout: await exists(dest), registered: config.refs[KEY] !== undefined };
  };
  const remove = (): Promise<void> => run(ctx, ['node', 'refs', 'remove', KEY, '--json']);
  return { home, remove, snapshot };
};

/** Starts `refs remove` while holding the ref lock; resolves to what was on disk just before the
 * lock was released, once the remove has finished. */
const removeWhileHeld = async (scene: Scene): Promise<Snapshot> => {
  const removing: Promise<void>[] = [];
  const whileHeld = await withLock(scene.home, refLockName(zRefKey.parse(KEY)), async () => {
    removing.push(scene.remove());
    await setTimeout(HELD_MS);
    return scene.snapshot();
  });
  await Promise.all(removing);
  return whileHeld;
};

describe('refs remove while another process holds the ref lock', () => {
  it('deletes and unregisters nothing until the holder releases, then finishes', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const scene = await sceneIn(homeDir);

        const whileHeld = await removeWhileHeld(scene);

        expect(whileHeld).toStrictEqual({ checkout: true, registered: true });
        await expect(scene.snapshot()).resolves.toStrictEqual({
          checkout: false,
          registered: false,
        });
      }),
    );
  });
});
