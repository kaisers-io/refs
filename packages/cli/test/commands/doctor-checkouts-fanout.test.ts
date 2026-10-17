import type { Config, RefsHome, RunOpts, RunResult, Runner } from '@kaisers-io/refs-core';
import {
  checkDirtyCheckouts,
  checkHooksGuard,
} from '../../src/commands/doctor-checks-checkouts.ts';
import { checkoutPath, readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import type { CliContext } from '../../src/context.ts';
import { HTTPS_REF_ENTRY } from '../helpers/doctor-support.ts';
import { setTimeout } from 'node:timers/promises';
import { testContext } from '../helpers/context.ts';
import { withTempHome } from '../helpers/add-support.ts';

// `hooks-guard` and `dirty-checkouts` start one `git` child per checkout. With many refs an
// unbounded fan-out starts all of them at once; these pin the cap, and that capping changed
// nothing else: every checkout is still asked, results come back in config order whatever order
// the children finish in, and a failure stays attached to its own checkout.

const CHECKOUTS = 24;
const CAP = 8;
const FAILING = 3;
const SLOW_CHILD_MS = 20;

const KEY_DIGITS = 2;
const keyAt = (index: number): string =>
  `github.com/acme/r${String(index).padStart(KEY_DIGITS, '0')}`;

type Answers = { failing: Partial<RunResult>; ok: Partial<RunResult> };
type Tracker = Runner & { asked: string[]; peak: number };

/** A runner that counts children in flight; the failing checkout's child answers first. */
const trackingRunner = (answers: Answers, failingDest: string): Tracker => {
  let inFlight = 0;
  const tracker: Tracker = {
    asked: [],
    peak: 0,
    run: async (_cmd: string, _args: readonly string[], opts?: RunOpts): Promise<RunResult> => {
      const cwd = opts?.cwd ?? '';
      const failing = cwd === failingDest;
      tracker.asked.push(cwd);
      inFlight += 1;
      tracker.peak = Math.max(tracker.peak, inFlight);
      // Long enough that, uncapped, every other child would have started before this one ends.
      await setTimeout(failing ? 0 : SLOW_CHILD_MS);
      inFlight -= 1;
      const answer = failing ? answers.failing : answers.ok;
      return { exitCode: 0, stderr: '', stdout: '', timedOut: false, ...answer };
    },
  };
  return tracker;
};

type Scene = {
  config: Config;
  ctx: CliContext;
  dests: string[];
  home: RefsHome;
  runner: Tracker;
};

const sceneWith = async (
  homeDir: string,
  answersFor: (home: RefsHome) => Answers,
): Promise<Scene> => {
  const home = resolveHome({ REFS_HOME: homeDir });
  const keys = Array.from({ length: CHECKOUTS }, (_unused, index) => keyAt(index));
  await seedConfig(home, Object.fromEntries(keys.map((key) => [key, HTTPS_REF_ENTRY])));
  const dests = keys.map((key) => checkoutPath(home, zRefKey.parse(key)));
  await Promise.all(dests.map((dest) => markCheckoutPresent(dest)));
  const runner = trackingRunner(answersFor(home), dests[FAILING] ?? '');
  const { ctx } = testContext();
  ctx.runner = runner;
  return { config: await readConfig(home), ctx, dests, home, runner };
};

describe('refs doctor: per-checkout git children are capped', () => {
  it('hooks-guard asks every checkout, at most a few at a time, and names the failing one', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { config, ctx, dests, home, runner } = await sceneWith(homeDir, (refsHome) => ({
        failing: { stdout: '' },
        ok: { stdout: refsHome.hooksDir },
      }));

      const result = await checkHooksGuard(ctx, home, config);

      expect(runner.peak).toBe(CAP);
      expect(runner.asked.toSorted()).toStrictEqual(dests.toSorted());
      expect(result.status).toBe('fail');
      expect(result.detail).toContain(`core.hooksPath not set for: ${keyAt(FAILING)} —`);
    });
  });

  it('dirty-checkouts keeps config order and the broken checkout its own error', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { config, ctx, home, runner } = await sceneWith(homeDir, () => ({
        failing: { exitCode: 128, stderr: 'fatal: not a git repository' },
        ok: { stdout: ' M README.md\n' },
      }));

      const result = await checkDirtyCheckouts(ctx, home, config);

      expect(runner.peak).toBe(CAP);
      expect(runner.asked).toHaveLength(CHECKOUTS);
      expect(result).toStrictEqual({
        detail: `${keyAt(FAILING)}: git status failed — fatal: not a git repository`,
        name: 'dirty-checkouts',
        status: 'fail',
      });
    });
  });
});

describe('refs doctor: a failing child releases its slot', () => {
  it('keeps asking when every child fails, and lists every checkout in config order', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const broken = { exitCode: 128, stderr: 'fatal: not a git repository' };
      const { config, ctx, home, runner } = await sceneWith(homeDir, () => ({
        failing: broken,
        ok: broken,
      }));

      const result = await checkDirtyCheckouts(ctx, home, config);

      expect(runner.peak).toBe(CAP);
      expect(runner.asked).toHaveLength(CHECKOUTS);
      const named = result.detail.split('; ').map((part) => part.split(':')[0]);
      expect(named).toStrictEqual(
        Array.from({ length: CHECKOUTS }, (_unused, index) => keyAt(index)),
      );
    });
  });
});
