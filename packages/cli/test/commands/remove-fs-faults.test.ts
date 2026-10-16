import { access, rm } from 'node:fs/promises';
import { checkoutPath, readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it, vi } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { dirname } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// `refs remove` against a filesystem that fails or races underneath it. The contract under test is
// `remove.ts`'s two-phase ordering: a failure anywhere in the checkout phase leaves the config entry
// in place (so `refs list` still shows the ref and the command can be re-run), a concurrent pruner
// that wins a race is not an error, and a re-run after a failure finishes the job.
//
// The faults are injected per path through a pass-through mock of `node:fs/promises`, not provoked
// with `chmod`, which behaves differently on Windows, where this suite also runs. A "race" fault
// first does what the competitor would have done (removes the directory for real) and then fails
// with ENOENT, which is what the losing call observes.

type Fault = () => Promise<never>;

// Hoisted with the mock below, which runs before this module's own bindings exist.
const { faults, wrap } = vi.hoisted(() => {
  const pending = new Map<string, () => Promise<never>>();
  const take = (call: string, path: unknown): (() => Promise<never>) | undefined => {
    const id = `${call} ${String(path)}`;
    const fault = pending.get(id);
    pending.delete(id);
    return fault;
  };
  const wrapCall = <TFn extends (path: never, ...rest: never[]) => Promise<unknown>>(
    call: string,
    original: TFn,
  ): TFn =>
    ((path: never, ...rest: never[]) => take(call, path)?.() ?? original(path, ...rest)) as TFn;
  return { faults: pending, wrap: wrapCall };
});

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    lstat: wrap('lstat', actual.lstat as never) as typeof actual.lstat,
    readdir: wrap('readdir', actual.readdir as never) as typeof actual.readdir,
    rmdir: wrap('rmdir', actual.rmdir),
  };
});

const LAST = -1;
const KEY = 'github.com/vercel/next.js';
const ENTRY = {
  default_branch: 'canary',
  description: 'The React Framework',
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};

const fsError = (code: string): Error => Object.assign(new Error(`${code}: injected`), { code });

const failWith =
  (code: string): Fault =>
  () =>
    Promise.reject(fsError(code));

/** A competitor removed `dir` first; this call then sees it gone. */
const raceRemoving =
  (dir: string): Fault =>
  async () => {
    await rm(dir, { force: true, recursive: true });
    throw fsError('ENOENT');
  };

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

type Scene = {
  dest: string;
  home: ReturnType<typeof resolveHome>;
  owner: string;
  remove: () => Promise<{ envelope: Record<string, unknown>; exitCode: unknown }>;
};

const sceneIn = async (homeDir: string): Promise<Scene> => {
  const { ctx, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedConfig(home, { [KEY]: ENTRY });
  const dest = checkoutPath(home, zRefKey.parse(KEY));
  await markCheckoutPresent(dest);
  const remove = async (): Promise<{ envelope: Record<string, unknown>; exitCode: unknown }> => {
    process.exitCode = undefined;
    await run(ctx, ['node', 'refs', 'remove', KEY, '--json']);
    return { envelope: JSON.parse(stdout.at(LAST) ?? '{}'), exitCode: process.exitCode };
  };
  return { dest, home, owner: dirname(dest), remove };
};

const isRegistered = async (scene: Scene): Promise<boolean> => {
  const config = await readConfig(scene.home);
  return config.refs[KEY] !== undefined;
};

const inScene = (exercise: (scene: Scene) => Promise<void>): Promise<void> =>
  withResetExitCode(() =>
    withTempHome(async (homeDir) => {
      faults.clear();
      await exercise(await sceneIn(homeDir));
      // Every injected fault was actually hit: a test whose fault never fired proves nothing.
      expect([...faults.keys()]).toStrictEqual([]);
    }),
  );

describe('refs remove: a failing filesystem leaves the ref registered', () => {
  it.each([
    { call: 'lstat', code: 'EACCES', on: 'dest', what: 'the checkout' },
    { call: 'lstat', code: 'EACCES', on: 'owner', what: 'an emptied parent' },
    { call: 'readdir', code: 'EIO', on: 'owner', what: 'an emptied parent' },
    { call: 'rmdir', code: 'EBUSY', on: 'owner', what: 'an emptied parent' },
  ] as const)('$call on $what failing is reported and keeps the entry', async (fault) => {
    expect.hasAssertions();
    const { call, code, on } = fault;
    await inScene(async (scene) => {
      faults.set(`${call} ${scene[on]}`, failWith(code));
      const { envelope, exitCode } = await scene.remove();
      expect(envelope['ok']).toBe(false);
      expect(exitCode).not.toBe(0);
      expect(JSON.stringify(envelope)).toContain(code);
      await expect(isRegistered(scene)).resolves.toBe(true);
    });
  });

  it('finishes on a re-run after the checkout was deleted but pruning failed', async () => {
    expect.hasAssertions();
    await inScene(async (scene) => {
      faults.set(`readdir ${scene.owner}`, failWith('EIO'));
      await scene.remove();
      await expect(exists(scene.dest)).resolves.toBe(false);
      const { envelope, exitCode } = await scene.remove();
      expect(exitCode).toBeUndefined();
      expect(envelope).toMatchObject({
        data: { key: KEY, removed_checkout: false },
        ok: true,
        warnings: ['checkout was already missing'],
      });
      await expect(isRegistered(scene)).resolves.toBe(false);
    });
  });
});

describe('refs remove: losing a pruning race to another process is not an error', () => {
  it.each([
    ['its lstat', 'lstat'],
    ['its readdir', 'readdir'],
    ['its rmdir', 'rmdir'],
  ] as const)('a parent removed before %s keeps pruning upward', async (_label, call) => {
    expect.hasAssertions();
    await inScene(async (scene) => {
      faults.set(`${call} ${scene.owner}`, raceRemoving(scene.owner));
      const { envelope, exitCode } = await scene.remove();
      expect(exitCode).toBeUndefined();
      expect(envelope).toMatchObject({ data: { removed_checkout: true }, ok: true });
      await expect(exists(dirname(scene.owner))).resolves.toBe(false);
      await expect(exists(scene.home.sourcesDir)).resolves.toBe(true);
      await expect(isRegistered(scene)).resolves.toBe(false);
    });
  });
});
