import type { Config, RefsHome, RunResult, Runner } from '@kaisers-io/refs-core';
import { HTTPS_REF_ENTRY, setupInitializedHome, withTempHome } from '../helpers/doctor-support.ts';
import {
  checkDirtyCheckouts,
  checkHooksGuard,
} from '../../src/commands/doctor-checks-checkouts.ts';
import { checkoutPath, zConfig, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent } from '../helpers/ref-fixtures.ts';
import { setImmediate } from 'node:timers/promises';

const COUNT = 11;
const LIMIT = 4;
const FAILURE = 1;
const SUCCESS = 0;

const seedCheckouts = async (home: RefsHome): Promise<Config> => {
  const refs = Object.fromEntries(
    Array.from({ length: COUNT }, (_unused, index) => [
      `github.com/acme/repo-${index}`,
      HTTPS_REF_ENTRY,
    ]),
  );
  await Promise.all(
    Object.keys(refs).map((key) => markCheckoutPresent(checkoutPath(home, zRefKey.parse(key)))),
  );
  return zConfig.parse({
    meta: { cli_version: '0.0.0-test', schema_version: 1 },
    refs,
    settings: {},
  });
};

const countingRunner = (
  home: RefsHome,
  fail: boolean,
): { runner: Runner; peak: () => number; calls: () => number } => {
  let active = 0;
  let maximum = 0;
  let count = 0;
  const run: Runner['run'] = async (_cmd, args): Promise<RunResult> => {
    active += 1;
    count += 1;
    maximum = Math.max(active, maximum);
    await setImmediate();
    active -= 1;
    return {
      exitCode: fail ? FAILURE : SUCCESS,
      stderr: fail ? 'inspection failed' : '',
      stdout: args.includes('config') ? home.hooksDir : ' M changed.txt',
    };
  };
  return { calls: () => count, peak: () => maximum, runner: { run } };
};

const checks = [checkHooksGuard, checkDirtyCheckouts];

describe('doctor checkout concurrency', () => {
  it.each(checks)('bounds every checkout probe while preserving all results', async (check) => {
    expect.hasAssertions();
    await withTempHome(async (dir) => {
      const { ctx, home } = await setupInitializedHome(dir);
      const config = await seedCheckouts(home);
      const counter = countingRunner(home, false);
      const result = await check({ ...ctx, runner: counter.runner }, home, config);
      expect(counter.peak()).toBe(LIMIT);
      expect(counter.calls()).toBe(COUNT);
      expect(result.status).not.toBe('fail');
    });
  });

  it.each(checks)('continues queued probes after failed git commands', async (check) => {
    expect.hasAssertions();
    await withTempHome(async (dir) => {
      const { ctx, home } = await setupInitializedHome(dir);
      const config = await seedCheckouts(home);
      const counter = countingRunner(home, true);
      const result = await check({ ...ctx, runner: counter.runner }, home, config);
      expect(counter.peak()).toBe(LIMIT);
      expect(counter.calls()).toBe(COUNT);
      expect(result.status).toBe('fail');
      expect(result.detail.indexOf('repo-1')).toBeLessThan(result.detail.indexOf('repo-2'));
    });
  });
});

// Release the first failed probe last, without depending on timer speed.
const mixedRunner = (home: RefsHome) => {
  const firstKey = zRefKey.parse('github.com/acme/repo-0');
  const secondKey = zRefKey.parse('github.com/acme/repo-1');
  const firstPath = checkoutPath(home, firstKey);
  const secondPath = checkoutPath(home, secondKey);
  const releaseFirst = Promise.withResolvers<void>();
  const completed: string[] = [];
  const runner: Runner = {
    run: async (_cmd, _args, options) => {
      const path = options?.cwd ?? '';
      if (path === firstPath) {
        await releaseFirst.promise;
      }
      completed.push(path);
      const broken = path === firstPath || path === secondPath;
      return {
        exitCode: broken ? FAILURE : SUCCESS,
        stderr: path === firstPath ? 'first failed' : 'second failed',
        stdout: broken ? '' : ' M changed.txt',
      };
    },
  };
  return { completed, firstKey, firstPath, releaseFirst, runner, secondKey, secondPath };
};

const exerciseMixedResults = async (dir: string) => {
  const { ctx, home } = await setupInitializedHome(dir);
  const config = await seedCheckouts(home);
  const tracker = mixedRunner(home);
  const checking = checkDirtyCheckouts({ ...ctx, runner: tracker.runner }, home, config);
  try {
    await expect.poll(() => tracker.completed.includes(tracker.secondPath)).toBe(true);
  } finally {
    tracker.releaseFirst.resolve();
  }
  return { result: await checking, tracker };
};

describe('doctor mixed checkout results', () => {
  it('keeps each error attached to its checkout after out-of-order completion', async () => {
    expect.hasAssertions();
    await withTempHome(async (dir) => {
      const { result, tracker } = await exerciseMixedResults(dir);
      expect(tracker.completed.indexOf(tracker.secondPath)).toBeLessThan(
        tracker.completed.indexOf(tracker.firstPath),
      );
      expect(tracker.completed).toHaveLength(COUNT);
      expect(result).toStrictEqual({
        detail: `${tracker.firstKey}: git status failed — first failed; ${tracker.secondKey}: git status failed — second failed`,
        name: 'dirty-checkouts',
        status: 'fail',
      });
    });
  });
});
