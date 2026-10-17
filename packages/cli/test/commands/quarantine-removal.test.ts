import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { checkoutPath, readConfig, resolveHome, zRefKey, zState } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { checkOrphans } from '../../src/commands/doctor-checks-orphans.ts';
import { incompleteMarker } from '../../src/commands/clone-lifecycle.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

const KEY = zRefKey.parse('github.com/example/quarantined');
const ENTRY = {
  default_branch: 'main',
  description: 'fixture checkout',
  url: 'https://github.com/example/quarantined',
};
const seedQuarantine = async (dir: string) => {
  const home = resolveHome({ REFS_HOME: dir });
  const dest = checkoutPath(home, KEY);
  const config = await seedConfig(home, { [KEY]: ENTRY });
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'writer-output'), 'preserve');
  await writeFile(incompleteMarker(dest), 'subprocess termination unconfirmed\n');
  return { config, dest, home };
};

const attemptRemoval = async (dir: string): Promise<void> => {
  const { ctx, runner, stdout } = testContext();
  ctx.env['REFS_HOME'] = dir;
  await run(ctx, ['node', 'refs', 'remove', KEY, '--json']);
  expect(JSON.parse(stdout.join(''))).toMatchObject({
    error: {
      code: 'conflict',
      message: expect.stringContaining('stop any remaining Git/helper processes'),
    },
    ok: false,
  });
  expect(runner.calls).toHaveLength(0);
};

const expectRetained = async (dir: string): Promise<void> => {
  const { dest, home } = await seedQuarantine(dir);
  await attemptRemoval(dir);
  await expect(readFile(join(dest, 'writer-output'), 'utf8')).resolves.toBe('preserve');
  await expect(access(incompleteMarker(dest))).resolves.toBeUndefined();
  const config = await readConfig(home);
  expect(config.refs[KEY]).toMatchObject(ENTRY);
};

describe('persistent checkout quarantine', () => {
  it('refuses destructive remove in a new CLI invocation and retains config, checkout and marker', async () => {
    expect.hasAssertions();
    await withResetExitCode(() => withTempHome(expectRetained));
  });

  it('does not offer an unconditional orphan removal command while a helper may still write', async () => {
    expect.hasAssertions();
    await withTempHome(async (dir) => {
      const { config, home } = await seedQuarantine(dir);
      const result = await checkOrphans(home, { ...config, refs: {} }, zState.parse({}));
      expect(result.status).toBe('warn');
      expect(result.detail).toContain(
        'stop any remaining Git/helper processes before manual cleanup',
      );
      expect(result.detail).not.toContain('remove with:');
    });
  });
});
