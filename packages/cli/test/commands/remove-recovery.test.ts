import { EXIT, withLock } from '@kaisers-io/refs-core';
import {
  KEY,
  expectFinished,
  expectRetained,
  remove,
  withFixture,
} from '../helpers/remove-recovery.ts';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
// eslint-disable-next-line no-duplicate-imports -- type-only overloads for the unmocked filesystem
import type { rm, rmdir } from 'node:fs/promises';
import type { Fixture } from '../helpers/remove-recovery.ts';
import { parseLastEnvelope } from '../helpers/add-support.ts';
import { refLockName } from '../../src/commands/add-source.ts';

// Keep the real filesystem and locking. Inject exactly one operation at one path so these
// error/race paths are deterministic on Windows as well as Unix; chmod is not portable.
const fault = vi.hoisted(() => ({
  effect: undefined as (() => Promise<void>) | undefined,
  operation: '',
  path: '',
}));
vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  // eslint-disable-next-line unicorn/consistent-function-scoping -- vi.mock factories are hoisted
  const before = async (operation: string, path: unknown): Promise<void> => {
    if (fault.operation === operation && fault.path === path) {
      const { effect } = fault;
      fault.effect = undefined;
      await effect?.();
    }
  };
  return {
    ...actual,
    lstat: vi.fn<(...args: Parameters<typeof actual.lstat>) => ReturnType<typeof actual.lstat>>(
      async (...args: Parameters<typeof actual.lstat>) => {
        await before('lstat', args[0]);
        return actual.lstat(...args);
      },
    ) as unknown as typeof actual.lstat,
    mkdir: vi.fn<typeof actual.mkdir>(actual.mkdir as never) as unknown as typeof actual.mkdir,
    readdir: vi.fn<
      (...args: Parameters<typeof actual.readdir>) => ReturnType<typeof actual.readdir>
    >(async (...args: Parameters<typeof actual.readdir>) => {
      await before('readdir', args[0]);
      return actual.readdir(...args);
    }) as unknown as typeof actual.readdir,
    rm: vi.fn<(...args: Parameters<typeof actual.rm>) => ReturnType<typeof actual.rm>>(
      async (...args: Parameters<typeof actual.rm>) => {
        await before('rm', args[0]);
        return actual.rm(...args);
      },
    ),
    rmdir: vi.fn<(...args: Parameters<typeof actual.rmdir>) => ReturnType<typeof actual.rmdir>>(
      async (...args: Parameters<typeof actual.rmdir>) => {
        await before('rmdir', args[0]);
        return actual.rmdir(...args);
      },
    ),
  };
});
const actual = await vi.importActual<{ rm: typeof rm; rmdir: typeof rmdir }>('node:fs/promises');
const arm = (operation: string, path: string, effect: () => Promise<void>): void => {
  Object.assign(fault, { effect, operation, path });
  onTestFinished(() => {
    const pending = fault.effect;
    fault.effect = undefined;
    expect(pending, 'the armed filesystem fault must be exercised').toBeUndefined();
  });
};
const ioError = (): NodeJS.ErrnoException =>
  Object.assign(new Error('injected filesystem failure'), { code: 'EIO' });
const failIo = (): Promise<void> => Promise.reject(ioError());

describe('remove failure recovery', () => {
  it('retains both entries after a partial deletion and finishes on retry', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const partial = join(fixture.dest, 'deleted-first');
      await writeFile(partial, 'partial removal');
      arm('rm', fixture.dest, async () => {
        await actual.rm(partial);
        throw ioError();
      });
      await remove(fixture);
      expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      await expectRetained(fixture);
      await expect(stat(partial)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(fixture.dest, 'keep'), 'utf8')).resolves.toBe('checkout data');
      await remove(fixture);
      await expectFinished(fixture);
    });
  });
});

const failureCases = [
  { method: 'lstat', name: 'checkout inspection', target: (fixture: Fixture) => fixture.dest },
  { method: 'rmdir', name: 'parent removal', target: (fixture: Fixture) => dirname(fixture.dest) },
  {
    method: 'lstat',
    name: 'parent inspection',
    target: (fixture: Fixture) => dirname(fixture.dest),
  },
  {
    method: 'readdir',
    name: 'parent listing',
    target: (fixture: Fixture) => dirname(fixture.dest),
  },
];
describe('remove metadata retention', () => {
  it.each(failureCases)(
    'retains entries after $name fails, then retries safely',
    async ({ method, target }) => {
      expect.hasAssertions();
      await withFixture(async (fixture) => {
        arm(method, target(fixture), failIo);
        await remove(fixture);
        expect(process.exitCode).toBe(EXIT.UNEXPECTED);
        expect(parseLastEnvelope(fixture.stdout)).toMatchObject({ ok: false });
        await expectRetained(fixture);
        await remove(fixture);
        await expectFinished(fixture);
      });
    },
  );

  it('preserves a sibling created during pruning and keeps metadata recoverable', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const parent = dirname(fixture.dest);
      const sibling = join(parent, 'arrived');
      arm('rmdir', parent, () => writeFile(sibling, 'keep new sibling'));
      await remove(fixture);
      expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      await expectRetained(fixture);
      await remove(fixture);
      await expectFinished(fixture);
      await expect(readFile(sibling, 'utf8')).resolves.toBe('keep new sibling');
    });
  });
});

describe('remove concurrent parent pruning', () => {
  it.each(['lstat', 'readdir', 'rmdir'])(
    'accepts an ancestor disappearing before %s',
    async (operation) => {
      expect.hasAssertions();
      await withFixture(async (fixture) => {
        const parent = dirname(fixture.dest);
        arm(operation, parent, () => actual.rmdir(parent));
        await remove(fixture);
        await expectFinished(fixture);
        await expect(stat(dirname(parent))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(fixture.home.sourcesDir)).resolves.toBeDefined();
      });
    },
  );
});

const WAITER_OBSERVATION_MS = 5000;
const holdRefLock = async (fixture: Fixture) => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const held = withLock(fixture.home, refLockName(KEY), () => {
    entered.resolve();
    return release.promise;
  });
  await entered.promise;
  return { held, release };
};

describe('remove under ref-lock contention', () => {
  it('does no destructive work until the real lock holder releases', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const { held, release } = await holdRefLock(fixture);
      const removing = remove(fixture);
      try {
        await expect
          .poll(
            () =>
              vi
                .mocked(mkdir)
                .mock.calls.filter(
                  ([path]) => path === join(fixture.home.locksDir, refLockName(KEY)),
                ).length,
            { timeout: WAITER_OBSERVATION_MS },
          )
          .toBeGreaterThan(1);
        await expectRetained(fixture);
        await expect(readFile(join(fixture.dest, 'keep'), 'utf8')).resolves.toBe('checkout data');
      } finally {
        release.resolve();
        await held;
        await removing;
      }
      await expectFinished(fixture);
    });
  });
});
