import { checkoutPath, readConfig, readState, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { markCheckoutPresent, seedConfig, seedState } from './ref-fixtures.ts';
import { parseLastEnvelope, withResetExitCode, withTempHome } from './add-support.ts';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { expect } from 'vitest';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from './context.ts';

const KEY = zRefKey.parse('github.com/acme/target');
const OTHER_KEY = 'github.com/other/keep';
const ENTRY = {
  default_branch: 'main',
  description: 'test source',
  url: 'https://github.com/acme/target',
};
const STATE = { effective_clone_mode: 'full', last_fetched_at: '2026-01-01T00:00:00Z' };

const makeFixture = async (homeDir: string) => {
  const { ctx, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  const dest = checkoutPath(home, KEY);
  await seedConfig(home, { [KEY]: ENTRY, [OTHER_KEY]: ENTRY });
  await seedState(home, { [KEY]: STATE, [OTHER_KEY]: STATE });
  await markCheckoutPresent(dest);
  await writeFile(join(dest, 'keep'), 'checkout data');
  await writeFile(join(home.root, 'unrelated'), 'untouched');
  return { ctx, dest, home, stdout };
};
type Fixture = Awaited<ReturnType<typeof makeFixture>>;

const withFixture = (exercise: (fixture: Fixture) => Promise<void>): Promise<void> =>
  withResetExitCode(() => withTempHome(async (homeDir) => exercise(await makeFixture(homeDir))));
const remove = async (fixture: Fixture): Promise<void> => {
  process.exitCode = undefined;
  await run(fixture.ctx, ['node', 'refs', 'remove', KEY, '--json']);
};
const expectRetained = async (fixture: Fixture): Promise<void> => {
  const config = await readConfig(fixture.home);
  const state = await readState(fixture.home);
  expect(config.refs[KEY]).toMatchObject(ENTRY);
  expect(state.refs[KEY]).toStrictEqual(STATE);
  await expect(readFile(join(fixture.home.root, 'unrelated'), 'utf8')).resolves.toBe('untouched');
};
const expectFinished = async (fixture: Fixture): Promise<void> => {
  const config = await readConfig(fixture.home);
  const state = await readState(fixture.home);
  expect(parseLastEnvelope(fixture.stdout)).toMatchObject({ data: { key: KEY }, ok: true });
  expect(config.refs[KEY]).toBeUndefined();
  expect(state.refs[KEY]).toBeUndefined();
  expect(config.refs[OTHER_KEY]).toMatchObject(ENTRY);
  expect(state.refs[OTHER_KEY]).toStrictEqual(STATE);
  await expect(stat(fixture.dest)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(fixture.home.root, 'unrelated'), 'utf8')).resolves.toBe('untouched');
};

export { KEY, expectFinished, expectRetained, remove, withFixture };
export type { Fixture };
