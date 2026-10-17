import { EXIT, withLock, zRefKey } from '@kaisers-io/refs-core';
import {
  TARGET_KEY,
  pathExists,
  removeTarget,
  setupRemoval,
  targetTracked,
} from '../helpers/remove-fixture.ts';
import { describe, expect, it } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { RemoveFixture } from '../helpers/remove-fixture.ts';
import { refLockName } from '../../src/commands/add-source.ts';
import { setTimeout as sleep } from 'node:timers/promises';

// `refs remove` deletes the checkout under the ref's own lock and drops the entry under the
// `'home'` lock (`remove.ts` header). These cases hold each lock from inside the test process
// while a removal runs, and look at what the removal has done while it is shut out. A removal
// that skipped the lock would finish inside the hold; the fixed wait below is far longer than an
// unlocked removal takes, so a pass is not a timing accident in that direction.

const HOLD_MS = 300;

type Hold = {
  /** Which lock the test holds. */
  lock: 'home' | 'ref';
  /** `[checkout present, entry tracked in config and state]` while the lock is held. */
  whileHeld: [boolean, [boolean, boolean]];
};

const lockNameFor = (lock: Hold['lock']): string =>
  lock === 'home' ? 'home' : refLockName(zRefKey.parse(TARGET_KEY));

const observe = async (fixture: RemoveFixture): Promise<Hold['whileHeld']> => [
  await pathExists(fixture.dest),
  await targetTracked(fixture.home),
];

describe('refs remove: waiting for a held lock', () => {
  it.each<Hold>([
    // Shut out of the ref lock, nothing may change yet: the checkout is untouched, and the entry
    // stays because it is only ever dropped after the checkout is gone.
    { lock: 'ref', whileHeld: [true, [true, true]] },
    // Shut out of the home lock only, the checkout is already deleted but the entry must wait.
    { lock: 'home', whileHeld: [false, [true, true]] },
  ])(
    'changes only what its order allows while the $lock lock is held',
    async ({ lock, whileHeld }) => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const fixture = await setupRemoval(homeDir);
          // The removal starts inside the hold and is awaited only after it, so it has to wait.
          const held = await withLock(fixture.home, lockNameFor(lock), async () => {
            const removal = removeTarget(fixture);
            await sleep(HOLD_MS);
            return { removal, seen: await observe(fixture) };
          });
          expect(held.seen).toStrictEqual(whileHeld);
          await expect(held.removal).resolves.toMatchObject({
            data: { removed_checkout: true },
            ok: true,
          });
          await expect(observe(fixture)).resolves.toStrictEqual([false, [false, false]]);
        }),
      );
    },
  );
});

// `lstat` failing with anything but ENOENT is a failure to look, not evidence of absence: reading
// it as "checkout already missing" would drop the entry while something still occupies the path.
// A regular file where the owner directory should be makes `lstat` of the checkout fail with
// ENOTDIR for any user, root included. Windows reports ENOENT for the same shape, so it is skipped.
describe.skipIf(process.platform === 'win32')(
  'refs remove: the checkout path cannot be inspected',
  () => {
    it('fails, keeps the entry, and leaves the obstruction alone', async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const fixture = await setupRemoval(homeDir);
          await rm(fixture.ownerDir, { force: true, recursive: true });
          await writeFile(fixture.ownerDir, 'not a directory');

          const envelope = await removeTarget(fixture);

          expect(envelope).toMatchObject({ error: { code: 'unexpected' }, ok: false });
          expect(process.exitCode).toBe(EXIT.UNEXPECTED);
          await expect(targetTracked(fixture.home)).resolves.toStrictEqual([true, true]);
          await expect(pathExists(fixture.ownerDir)).resolves.toBe(true);
        }),
      );
    });
  },
);
