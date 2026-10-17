import { EXIT, withLock, zRefKey } from '@kaisers-io/refs-core';
import {
  TARGET_KEY,
  pathExists,
  removeTarget,
  setupRemoval,
  targetTracked,
} from '../helpers/remove-fixture.ts';
import { describe, expect, it, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { RemoveFixture } from '../helpers/remove-fixture.ts';
import { join } from 'node:path';
import { refLockName } from '../../src/commands/add-source.ts';

// `refs remove` deletes the checkout under the ref's own lock and drops the entry under the
// `'home'` lock (`remove.ts` header). These cases hold each lock from inside the test process
// while a removal runs, and look at what the removal has done while it is shut out. They look only
// once the removal has actually tried that lock and been refused, so a removal that skipped the
// lock, however slow under load, would already have done its work by the time anyone looks.
//
// `mkdir` is spied, not altered: every call still reaches the real filesystem. The spy only
// counts the attempts on the held lock's directory — the holder's own, then the removal's.

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  // Overloaded signature; cast back as `lock-inspect-unreadable.test.ts` does for `stat`.
  const mkdirSpy = vi.fn<typeof actual.mkdir>(actual.mkdir as never);
  return { ...actual, mkdir: mkdirSpy as unknown as typeof actual.mkdir };
});

const WAITER_TIMEOUT_MS = 5000;

type Hold = {
  /** Which lock the test holds. */
  lock: 'home' | 'ref';
  /** `[checkout present, entry tracked in config and state]` while the lock is held. */
  whileHeld: [boolean, [boolean, boolean]];
};

const lockNameFor = (lock: Hold['lock']): string =>
  lock === 'home' ? 'home' : refLockName(zRefKey.parse(TARGET_KEY));

/** How many times `mkdir` has been called on the lock directory: 1 is the holder's acquisition,
 * anything more is the removal trying the same lock and being refused. */
const attempts = (fixture: RemoveFixture, lock: Hold['lock']): number => {
  const lockDir = join(fixture.home.locksDir, lockNameFor(lock));
  return vi.mocked(mkdir).mock.calls.filter(([path]) => path === lockDir).length;
};

const pollOpts = { timeout: WAITER_TIMEOUT_MS };

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
            await expect.poll(() => attempts(fixture, lock), pollOpts).toBeGreaterThan(1);
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
