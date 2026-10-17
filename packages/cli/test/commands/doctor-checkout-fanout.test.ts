import {
  CHECKOUT_GIT_CONCURRENCY,
  checkDirtyCheckouts,
  checkHooksGuard,
} from '../../src/commands/doctor-checks-checkouts.ts';
import type { Config, RefsHome, RunResult } from '@kaisers-io/refs-core';
import { HTTPS_REF_ENTRY, setupInitializedHome, withTempHome } from '../helpers/doctor-support.ts';
import { checkoutPath, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import type { CliContext } from '../../src/context.ts';
import type { PeakRunner } from '../helpers/peak-runner.ts';
import { createPeakRunner } from '../helpers/peak-runner.ts';

// `hooks-guard` and `dirty-checkouts` run one `git` child per existing checkout. They used to start
// all of them at once, so a home with hundreds of refs spawned hundreds of processes in one burst.
// These cases give the checks more checkouts than the cap, and pin both halves of the contract:
// never more than the cap in flight, and every result still attributed to its own checkout.

// Comfortably more than the cap, so an unbounded fan-out shows a peak far above it.
const CHECKOUT_COUNT =
  CHECKOUT_GIT_CONCURRENCY + CHECKOUT_GIT_CONCURRENCY + CHECKOUT_GIT_CONCURRENCY;
// One ref near the end of the list, not the last: if the gating reordered results, the finding
// would name a different key.
const ODD_INDEX = CHECKOUT_COUNT - CHECKOUT_GIT_CONCURRENCY + 1;
const GIT_FATAL_EXIT = 128;
const KEY_DIGITS = 2;

const keyAt = (index: number): string =>
  `github.com/acme/repo-${String(index).padStart(KEY_DIGITS, '0')}`;

type Fixture = {
  config: Config;
  ctx: CliContext;
  home: RefsHome;
};

type Answers = {
  odd: Partial<RunResult>;
  rest: Partial<RunResult>;
};

const seedManyCheckouts = async (homeDir: string): Promise<Fixture> => {
  const { ctx, home } = await setupInitializedHome(homeDir);
  const keys = Array.from({ length: CHECKOUT_COUNT }, (_unused, index) => keyAt(index));
  const config = await seedConfig(
    home,
    Object.fromEntries(keys.map((key) => [key, HTTPS_REF_ENTRY])),
  );
  await Promise.all(keys.map((key) => markCheckoutPresent(checkoutPath(home, zRefKey.parse(key)))));
  return { config, ctx, home };
};

/** Answers `odd` for the one checkout at `ODD_INDEX` and `rest` for every other one. */
const installRunner = (fixture: Fixture, answers: Answers): PeakRunner => {
  const oddDest = checkoutPath(fixture.home, zRefKey.parse(keyAt(ODD_INDEX)));
  const runner = createPeakRunner({
    respond: (_args, cwd) => (cwd === oddDest ? answers.odd : answers.rest),
    total: CHECKOUT_COUNT,
    width: CHECKOUT_GIT_CONCURRENCY,
  });
  fixture.ctx.runner = runner;
  return runner;
};

describe('refs doctor: bounded hooks-guard fan-out', () => {
  it('never runs more than the cap at once and still names the one bad checkout', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const fixture = await seedManyCheckouts(homeDir);
      const runner = installRunner(fixture, {
        odd: { stdout: '/some/other/hooks' },
        rest: { stdout: fixture.home.hooksDir },
      });

      const result = await checkHooksGuard(fixture.ctx, fixture.home, fixture.config);

      expect(runner.calls()).toBe(CHECKOUT_COUNT);
      expect(runner.peak()).toBe(CHECKOUT_GIT_CONCURRENCY);
      expect(result.status).toBe('fail');
      expect(result.detail).toBe(
        `core.hooksPath not set for: ${keyAt(ODD_INDEX)} — run: refs init`,
      );
    });
  });
});

describe('refs doctor: bounded dirty-checkouts fan-out', () => {
  it('never runs more than the cap at once and still names the one dirty checkout', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const fixture = await seedManyCheckouts(homeDir);
      const runner = installRunner(fixture, { odd: { stdout: ' M README.md\n' }, rest: {} });

      const result = await checkDirtyCheckouts(fixture.ctx, fixture.home, fixture.config);

      expect(runner.calls()).toBe(CHECKOUT_COUNT);
      expect(runner.peak()).toBe(CHECKOUT_GIT_CONCURRENCY);
      expect(result).toStrictEqual({
        detail: `local changes will be discarded on next sync: ${keyAt(ODD_INDEX)}`,
        name: 'dirty-checkouts',
        status: 'warn',
      });
    });
  });

  it('still reports a checkout git could not inspect as broken', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const fixture = await seedManyCheckouts(homeDir);
      installRunner(fixture, {
        odd: { exitCode: GIT_FATAL_EXIT, stderr: 'fatal: not a git repository' },
        rest: {},
      });

      const result = await checkDirtyCheckouts(fixture.ctx, fixture.home, fixture.config);

      expect(result.status).toBe('fail');
      expect(result.detail).toBe(
        `${keyAt(ODD_INDEX)}: git status failed — fatal: not a git repository`,
      );
    });
  });
});

describe('refs doctor: dirty-checkouts order under the cap', () => {
  it('lists every checkout git could not inspect in config order, not finishing order', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const fixture = await seedManyCheckouts(homeDir);
      const broken = { exitCode: GIT_FATAL_EXIT, stderr: 'fatal: not a git repository' };
      const runner = installRunner(fixture, { odd: broken, rest: broken });

      const result = await checkDirtyCheckouts(fixture.ctx, fixture.home, fixture.config);

      expect(runner.calls()).toBe(CHECKOUT_COUNT);
      expect(result.status).toBe('fail');
      expect(result.detail.split('; ').map((part) => part.split(':')[0])).toStrictEqual(
        Array.from({ length: CHECKOUT_COUNT }, (_unused, index) => keyAt(index)),
      );
    });
  });
});
