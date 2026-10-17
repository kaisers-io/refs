import { describe, expect, it, vi } from 'vitest';
import {
  expectUnrelatedUntouched,
  pathExists,
  removeTarget,
  setupRemoval,
  targetTracked,
} from '../helpers/remove-fixture.ts';
import { lstat, readdir, rmdir } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { RemoveFixture } from '../helpers/remove-fixture.ts';
import { dirname } from 'node:path';

// Pruning walks upward from the deleted checkout one directory at a time, and another process
// pruning the same tree — a second `refs remove` of a sibling, say — can delete a directory
// between any two of its steps. Each case removes the owner directory just before one step reads
// it, which is that race won by the other side. Losing it is not an error: the directory is gone
// either way, so the removal must succeed and the walk must carry on to the now-empty host
// directory above. A walk that stopped instead would leave `sources/github.com/` behind.

type PruneStep = 'lstat' | 'readdir' | 'rmdir';
type RealFs = Record<PruneStep, (...args: unknown[]) => Promise<unknown>>;

// The real functions, captured by the mock factory: the "concurrent pruner" and every call the
// race does not target go straight to the filesystem.
const real = vi.hoisted<Partial<RealFs>>(() => ({}));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  Object.assign(real, { lstat: actual.lstat, readdir: actual.readdir, rmdir: actual.rmdir });
  // Overloaded signatures; cast back as `lock-inspect-unreadable.test.ts` does for `stat`.
  return {
    ...actual,
    lstat: vi.fn<typeof actual.lstat>(actual.lstat as never) as unknown as typeof actual.lstat,
    readdir: vi.fn<typeof actual.readdir>(
      actual.readdir as never,
    ) as unknown as typeof actual.readdir,
    rmdir: vi.fn<typeof actual.rmdir>(actual.rmdir),
  };
});

/** The first time `step` is called on `target`, a "concurrent pruner" removes `target` for real
 * and then the real call runs — and meets the ENOENT that losing the race produces. */
const loseRaceAt = (step: PruneStep, target: string): void => {
  const spies = { lstat, readdir, rmdir };
  const passThrough = real[step];
  let fired = false;
  vi.mocked(spies[step]).mockImplementation((async (path: unknown, ...rest: unknown[]) => {
    if (!fired && path === target) {
      fired = true;
      await real.rmdir?.(target);
    }
    return passThrough?.(path, ...rest);
  }) as never);
};

const expectPrunedToSources = async (fixture: RemoveFixture): Promise<void> => {
  await expect(pathExists(fixture.ownerDir)).resolves.toBe(false);
  await expect(pathExists(dirname(fixture.ownerDir))).resolves.toBe(false);
  await expect(pathExists(fixture.home.sourcesDir)).resolves.toBe(true);
};

describe('refs remove: a concurrent pruner removes the owner directory first', () => {
  it.each<PruneStep>(['lstat', 'readdir', 'rmdir'])(
    'treats the directory vanishing before %s as pruned and keeps walking up',
    async (step) => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const fixture = await setupRemoval(homeDir);
          loseRaceAt(step, fixture.ownerDir);

          const envelope = await removeTarget(fixture);

          expect(envelope).toMatchObject({
            data: { removed_checkout: true },
            ok: true,
            warnings: [],
          });
          await expect(targetTracked(fixture.home)).resolves.toStrictEqual([false, false]);
          await expectPrunedToSources(fixture);
          await expectUnrelatedUntouched(fixture);
        }),
      );
    },
  );
});
