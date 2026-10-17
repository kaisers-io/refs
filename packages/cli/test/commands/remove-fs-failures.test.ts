import { describe, expect, it, vi } from 'vitest';
import {
  expectUnrelatedUntouched,
  pathExists,
  removeTarget,
  setupRemoval,
  targetTracked,
} from '../helpers/remove-fixture.ts';
import { lstat, readdir, rm, rmdir } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { EXIT } from '@kaisers-io/refs-core';
import type { RemoveFixture } from '../helpers/remove-fixture.ts';

// `refs remove` deletes the checkout first and drops the config/state entry second, so that any
// failure in between leaves the ref tracked and the command retryable (`remove.ts` header). These
// cases make the filesystem fail at each step after the containment check and pin that recovery
// contract: the failure is loud, the entry survives it, and a plain retry finishes the job.
//
// Each failure is injected for ONE path, once. Everything else — config writes, the lock
// directory, the unrelated ref — runs against the real filesystem, so a failure that leaked past
// its target would show up as damage to the unrelated ref. The errors are mocked because root
// ignores permission bits, so chmod cannot provoke them in every environment this suite runs in.

type FsStep = 'lstat' | 'readdir' | 'rm' | 'rmdir';
type RealFs = Record<FsStep, (...args: unknown[]) => Promise<unknown>>;

// The real functions, captured by the mock factory, so an injected failure can pass every call it
// does not target straight through.
const real = vi.hoisted<Partial<RealFs>>(() => ({}));

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  Object.assign(real, {
    lstat: actual.lstat,
    readdir: actual.readdir,
    rm: actual.rm,
    rmdir: actual.rmdir,
  });
  // `lstat`, `readdir` and `rm` are overloaded, and vi.fn cannot reproduce every overload — cast
  // back to the original signature, as `lock-inspect-unreadable.test.ts` does for `stat`.
  return {
    ...actual,
    lstat: vi.fn<typeof actual.lstat>(actual.lstat as never) as unknown as typeof actual.lstat,
    readdir: vi.fn<typeof actual.readdir>(
      actual.readdir as never,
    ) as unknown as typeof actual.readdir,
    rm: vi.fn<typeof actual.rm>(actual.rm),
    rmdir: vi.fn<typeof actual.rmdir>(actual.rmdir),
  };
});

const fsError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(`${code}: injected`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

/** Makes `step` reject with `code` the first time it is called on `target`, and pass every other
 * call through to the real filesystem. */
const failOnce = (step: FsStep, target: string, code: string): void => {
  const spies = { lstat, readdir, rm, rmdir };
  const passThrough = real[step];
  let fired = false;
  vi.mocked(spies[step]).mockImplementation(((path: unknown, ...rest: unknown[]) => {
    if (!fired && path === target) {
      fired = true;
      return Promise.reject(fsError(code));
    }
    return passThrough?.(path, ...rest);
  }) as never);
};

type FailureCase = {
  code: string;
  /** Whether the checkout is still on disk after the failed run. */
  checkoutSurvives: boolean;
  /** What the retry reports: it finds a checkout to delete only if the first run never got to. */
  retry: { data: { removed_checkout: boolean }; warnings: string[] };
  step: FsStep;
  target: keyof Pick<RemoveFixture, 'dest' | 'ownerDir'>;
};

const ALREADY_MISSING = {
  data: { removed_checkout: false },
  warnings: ['checkout was already missing'],
};

const CASES: FailureCase[] = [
  // The delete itself fails: nothing is gone yet, and the retry deletes the checkout.
  {
    checkoutSurvives: true,
    code: 'EBUSY',
    retry: { data: { removed_checkout: true }, warnings: [] },
    step: 'rm',
    target: 'dest',
  },
  // Pruning runs after the checkout is gone. A non-ENOENT error there must still surface rather
  // than read as "nothing left to prune"; the retry, finding no checkout, drops the entry.
  {
    checkoutSurvives: false,
    code: 'EIO',
    retry: ALREADY_MISSING,
    step: 'lstat',
    target: 'ownerDir',
  },
  {
    checkoutSurvives: false,
    code: 'EIO',
    retry: ALREADY_MISSING,
    step: 'readdir',
    target: 'ownerDir',
  },
  {
    checkoutSurvives: false,
    code: 'EIO',
    retry: ALREADY_MISSING,
    step: 'rmdir',
    target: 'ownerDir',
  },
];

const expectFailedKeepingEntry = async (
  fixture: RemoveFixture,
  row: FailureCase,
): Promise<void> => {
  await expect(removeTarget(fixture)).resolves.toMatchObject({
    error: { code: 'unexpected' },
    ok: false,
  });
  expect(process.exitCode).toBe(EXIT.UNEXPECTED);
  await expect(pathExists(fixture.dest)).resolves.toBe(row.checkoutSurvives);
  await expect(targetTracked(fixture.home)).resolves.toStrictEqual([true, true]);
};

const expectRetryFinishes = async (fixture: RemoveFixture, row: FailureCase): Promise<void> => {
  await expect(removeTarget(fixture)).resolves.toMatchObject({ ...row.retry, ok: true });
  await expect(pathExists(fixture.dest)).resolves.toBe(false);
  await expect(targetTracked(fixture.home)).resolves.toStrictEqual([false, false]);
  await expectUnrelatedUntouched(fixture);
};

describe('refs remove: a filesystem failure part-way through', () => {
  it.each(CASES)(
    'surfaces a failing $step on the $target, keeps the entry, and a retry finishes',
    async (row) => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const fixture = await setupRemoval(homeDir);
          failOnce(row.step, fixture[row.target], row.code);

          await expectFailedKeepingEntry(fixture, row);
          await expectRetryFinishes(fixture, row);
        }),
      );
    },
  );
});
