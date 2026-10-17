import { FakeRunner, resolveHome } from '@kaisers-io/refs-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  assertCloneComplete,
  incompleteMarker,
  withCheckoutProtection,
  withFreshClone,
} from '../../src/commands/clone-lifecycle.ts';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { withTempHome } from '../helpers/add-support.ts';

class UnconfirmedRunner extends FakeRunner {
  terminationFailed = false;
}
const fixture = async (dir: string) => {
  const home = resolveHome({ REFS_HOME: dir });
  await mkdir(home.sourcesDir, { recursive: true });
  return { dest: join(home.sourcesDir, 'checkout'), home, runner: new UnconfirmedRunner() };
};

describe('checkout quarantine after unconfirmed process termination', () => {
  it('retains a partial fresh clone and its marker instead of deleting a possible live writer’s files', async () => {
    expect.hasAssertions();
    await withTempHome(async (dir) => {
      const opts = await fixture(dir);
      await expect(
        withFreshClone(opts, async () => {
          await writeFile(join(opts.dest, 'partial'), 'preserve');
          opts.runner.terminationFailed = true;
          throw new Error('tree termination unconfirmed');
        }),
      ).rejects.toThrow('tree termination unconfirmed');
      await expect(readFile(join(opts.dest, 'partial'), 'utf8')).resolves.toBe('preserve');
      expect(() => assertCloneComplete(opts.dest)).toThrow(
        'stop any remaining Git/helper processes',
      );
    });
  });

  it('quarantines an existing checkout before releasing its operation and refuses future reuse', async () => {
    expect.hasAssertions();
    await withTempHome(async (dir) => {
      const opts = await fixture(dir);
      await mkdir(opts.dest);
      await expect(
        withCheckoutProtection(opts.runner, opts, () => {
          opts.runner.terminationFailed = true;
          return Promise.resolve('not safe');
        }),
      ).rejects.toThrow('quarantined');
      await expect(access(incompleteMarker(opts.dest))).resolves.toBeUndefined();
      await expect(access(opts.dest)).resolves.toBeUndefined();
      await expect(
        withCheckoutProtection(new FakeRunner(), opts, () => Promise.resolve('unsafe reuse')),
      ).rejects.toThrow('interrupted clone');
    });
  });
});
