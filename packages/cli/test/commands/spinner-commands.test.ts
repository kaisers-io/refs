import { describe, expect, it } from 'vitest';
import {
  expectGitVersion,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { rm } from 'node:fs/promises';
import { run } from '../../src/main.ts';
import { setupTwoRefs } from '../helpers/sync-support.ts';

// What `doctor` and `sync` tell the spinner, and when. The renderer itself is covered in
// spinner.test.ts and on a real terminal in spinner-pty.test.ts; these pin the commands' side: the
// labels a person sees, a sync count that includes failed refs, no spinner at all under `--json`,
// and the spinner stopped before anything is printed, including an error.

const NOT_FOUND = -1;
const LAST = -1;
const FIRST_THREE = 3;
// The spinner's label, then its stop, then the error.
const ERROR_POSITION = 2;

const isLabel = (entry: string): boolean =>
  entry.startsWith('spinner: ') && entry !== 'spinner: stop';

/** Records spinner calls and output on `ctx` in the order they happen. */
const recordTimeline = (ctx: CliContext): string[] => {
  const timeline: string[] = [];
  const { errLine, out } = ctx;
  ctx.spinner = () => ({
    stop: () => {
      timeline.push('spinner: stop');
    },
    update: (text: string) => {
      timeline.push(`spinner: ${text}`);
    },
  });
  ctx.out = (line) => {
    timeline.push(`out: ${line}`);
    out(line);
  };
  ctx.errLine = (line) => {
    timeline.push(`err: ${line}`);
    errLine(line);
  };
  return timeline;
};

const firstOutput = (timeline: readonly string[]): number =>
  timeline.findIndex((entry) => entry.startsWith('out: ') || entry.startsWith('err: '));

describe('refs doctor: spinner', () => {
  it('names each check as it runs and stops before printing the results', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        const timeline = recordTimeline(ctx);
        await run(ctx, ['node', 'refs', 'doctor']);
        const labels = timeline.filter((entry) => isLabel(entry));
        expect(labels.slice(0, FIRST_THREE)).toStrictEqual([
          'spinner: Reading config and state',
          'spinner: Checking Git',
          'spinner: Checking Node.js',
        ]);
        expect(labels).toContain('spinner: Comparing registered packages with the checkouts');
        expect(timeline.indexOf('spinner: stop')).toBe(firstOutput(timeline) - 1);
      }),
    );
  });

  it('starts no spinner under --json', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);
        const timeline = recordTimeline(ctx);
        await run(ctx, ['node', 'refs', 'doctor', '--json']);
        expect(timeline.filter((entry) => entry.startsWith('spinner: '))).toStrictEqual([]);
      }),
    );
  });
});

describe('refs sync: spinner', () => {
  it('stops before the error when the command fails', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupInitializedHome(homeDir);
        await rm(`${homeDir}/config.toml`);
        const timeline = recordTimeline(ctx);
        await run(ctx, ['node', 'refs', 'sync']);
        expect(timeline.slice(0, ERROR_POSITION)).toStrictEqual([
          'spinner: Reading the config',
          'spinner: stop',
        ]);
        expect(firstOutput(timeline)).toBe(ERROR_POSITION);
      }),
    );
  });

  it(
    'counts a failed ref as done and ends at n/n before printing the summary',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { bad, badFixture, ctx, good } = await setupTwoRefs(homeDir);
          await rm(bad.dest, { force: true, recursive: true });
          await rm(badFixture.dir, { force: true, recursive: true });
          const timeline = recordTimeline(ctx);
          await run(ctx, ['node', 'refs', 'sync', good.key, bad.key]);
          const counts = timeline.filter((entry) => entry.startsWith('spinner: Syncing refs ('));
          expect(counts.at(0)).toMatch(/^spinner: Syncing refs \(0\/2 done\): /u);
          expect(counts.at(LAST)).toBe('spinner: Syncing refs (2/2 done)');
          expect(timeline.indexOf('spinner: stop')).toBeLessThan(firstOutput(timeline));
          expect(firstOutput(timeline)).not.toBe(NOT_FOUND);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
