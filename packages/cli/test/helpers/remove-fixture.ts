import { checkoutPath, readConfig, readState, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { markCheckoutPresent, seedConfig, seedState } from './ref-fixtures.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { RefsHome } from '@kaisers-io/refs-core';
import { access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect } from 'vitest';
import { run } from '../../src/main.ts';
import { testContext } from './context.ts';

// Shared by the `refs remove` failure, race and contention suites. Every fixture carries the ref
// being removed AND an unrelated ref on another host, each with config, state and a checkout, so a
// case can assert both what the removal did and what it left alone. The unrelated ref lives under
// a different host on purpose: the removed ref's `github.com/` directory is then prunable, which
// is what the race cases need to show that pruning carried on upward.

const TARGET_KEY = 'github.com/vercel/next.js';
const UNRELATED_KEY = 'gitlab.com/acme/widget';

const entryFor = (key: string): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'A remove fixture.',
  tag_format: 'v{version}',
  url: `https://${key}`,
});

type RemoveEnvelope = {
  data?: { key: string; removed_checkout: boolean };
  error?: { code: string; message: string };
  ok: boolean;
  warnings?: string[];
};

type RemoveFixture = {
  ctx: ReturnType<typeof testContext>['ctx'];
  dest: string;
  home: RefsHome;
  /** The removed checkout's owner directory, `sources/github.com/vercel` — the first one pruned. */
  ownerDir: string;
  stdout: string[];
  unrelatedDest: string;
};

const seedBothRefs = async (home: RefsHome): Promise<void> => {
  await seedConfig(home, {
    [TARGET_KEY]: entryFor(TARGET_KEY),
    [UNRELATED_KEY]: entryFor(UNRELATED_KEY),
  });
  const fetched = { last_fetched_at: new Date().toISOString() };
  await seedState(home, { [TARGET_KEY]: fetched, [UNRELATED_KEY]: fetched });
};

const setupRemoval = async (homeDir: string): Promise<RemoveFixture> => {
  const { ctx, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedBothRefs(home);
  const dest = checkoutPath(home, zRefKey.parse(TARGET_KEY));
  const unrelatedDest = checkoutPath(home, zRefKey.parse(UNRELATED_KEY));
  await markCheckoutPresent(dest);
  await markCheckoutPresent(unrelatedDest);
  return { ctx, dest, home, ownerDir: dirname(dest), stdout, unrelatedDest };
};

/** Runs `refs remove <target> --json` and returns the envelope it printed. Clears `stdout` first,
 * so a retry in the same fixture reads its own envelope rather than the first run's. */
const removeTarget = async (fixture: RemoveFixture): Promise<RemoveEnvelope> => {
  fixture.stdout.length = 0;
  await run(fixture.ctx, ['node', 'refs', 'remove', TARGET_KEY, '--json']);
  const [line] = fixture.stdout;
  if (line === undefined) {
    throw new Error('expected a json envelope line, got none');
  }
  return JSON.parse(line) as RemoveEnvelope;
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/** Whether the target ref is still in config AND in state, as a pair: the two must never disagree. */
const targetTracked = async (home: RefsHome): Promise<[boolean, boolean]> => {
  const config = await readConfig(home);
  const state = await readState(home);
  return [config.refs[TARGET_KEY] !== undefined, state.refs[TARGET_KEY] !== undefined];
};

/** The unrelated ref keeps its config, its state and its checkout, whatever happened to the target. */
const expectUnrelatedUntouched = async (fixture: RemoveFixture): Promise<void> => {
  const config = await readConfig(fixture.home);
  const state = await readState(fixture.home);
  expect(config.refs[UNRELATED_KEY]).toBeDefined();
  expect(state.refs[UNRELATED_KEY]).toBeDefined();
  await expect(pathExists(fixture.unrelatedDest)).resolves.toBe(true);
};

export {
  TARGET_KEY,
  expectUnrelatedUntouched,
  pathExists,
  removeTarget,
  setupRemoval,
  targetTracked,
};
export type { RemoveEnvelope, RemoveFixture };
