import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import {
  assertCloneComplete,
  incompleteMarker,
  withFreshClone,
} from '../../src/commands/clone-lifecycle.ts';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveHome } from '@kaisers-io/refs-core';
import { withTempHome } from '../helpers/add-support.ts';

const fixture = async (homeDir: string) => {
  const home = resolveHome({ REFS_HOME: homeDir });
  await mkdir(home.sourcesDir, { recursive: true });
  return { dest: join(home.sourcesDir, 'clone'), home };
};

describe('fresh clone ownership', () => {
  it('removes an owned partial checkout on failure and permits a fresh retry', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const opts = await fixture(homeDir);
      await expect(
        withFreshClone(opts, async () => {
          await mkdir(join(opts.dest, '.git'));
          await writeFile(join(opts.dest, '.git', 'config'), '[core]\n hooksPath = owned\n');
          throw new Error('checkout failed');
        }),
      ).rejects.toThrow('checkout failed');
      await expect(access(opts.dest)).rejects.toThrow(/ENOENT/u);
      expect(() => assertCloneComplete(opts.dest)).not.toThrow();
      await expect(withFreshClone(opts, () => Promise.resolve('retried'))).resolves.toBe('retried');
      await expect(access(opts.dest)).resolves.toBeUndefined();
    });
  });

  it('never removes or clones into a preexisting directory', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const opts = await fixture(homeDir);
      await mkdir(opts.dest);
      await writeFile(join(opts.dest, 'keep'), 'existing content');
      await expect(
        withFreshClone(opts, () => Promise.reject(new Error('must not run'))),
      ).rejects.toThrow('existing paths');
      await expect(readFile(join(opts.dest, 'keep'), 'utf8')).resolves.toBe('existing content');
    });
  });

  it('rejects an interrupted checkout even when Git and the managed marker already exist', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const opts = await fixture(homeDir);
      await mkdir(join(opts.dest, '.git'), { recursive: true });
      await writeFile(incompleteMarker(opts.dest), '');
      expect(() => assertCloneComplete(opts.dest)).toThrow('interrupted clone');
      await rm(incompleteMarker(opts.dest));
      expect(() => assertCloneComplete(opts.dest)).not.toThrow();
    });
  });
});

describe('fresh clone cleanup ownership races', () => {
  it('retains a replaced destination and its incomplete marker instead of deleting someone else’s directory', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const opts = await fixture(homeDir);
      await expect(
        withFreshClone(opts, async () => {
          await rename(opts.dest, `${opts.dest}-original`);
          await mkdir(opts.dest);
          await writeFile(join(opts.dest, 'keep'), 'replacement');
          throw new Error('clone failed');
        }),
      ).rejects.toThrow('destination changed');
      await expect(readFile(join(opts.dest, 'keep'), 'utf8')).resolves.toBe('replacement');
      expect(() => assertCloneComplete(opts.dest)).toThrow('interrupted clone');
    });
  });

  it('cleans its empty reservation if the incomplete marker cannot be reserved', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const opts = await fixture(homeDir);
      await writeFile(incompleteMarker(opts.dest), 'preexisting marker');
      await expect(withFreshClone(opts, () => Promise.resolve())).rejects.toThrow(/EEXIST/u);
      await expect(access(opts.dest)).rejects.toThrow(/ENOENT/u);
      await expect(readFile(incompleteMarker(opts.dest), 'utf8')).resolves.toBe(
        'preexisting marker',
      );
    });
  });
});
