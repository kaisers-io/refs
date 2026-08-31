import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import type { FixtureRepo } from '../helpers/fixture-repo.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { resolveAddSource } from '../../src/commands/add-source.ts';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// Coverage for `refs add`'s stderr progress lines (cloning/detecting a huge repo can otherwise
// run for minutes with zero output) — split out of `add.test.ts` purely to keep that file under
// the repo's 300-line oxlint cap.

const CLONE_LINE_PATTERN = /^refs: cloning file:\/\/.* into .*…$/u;
const DETECT_LINE = 'refs: detecting workspace packages…';
const NPM_LINE_PATTERN = /resolving npm package/u;
const JSON_MODE_STDOUT_LINES = 1;
const HUMAN_MODE_STDOUT_LINES = 2;
const FIRST_LINE = 0;
const HTTP_STATUS_OK = 200;

/** Shared setup for both progress tests below: a fresh temp home + a plain (non-monorepo) fixture
 * repo, with `stdout`/`stderr` cleared of `initHome`'s own noise right before the exercised `add`
 * call — split out purely to keep each `it` body under the repo's 10-statement oxlint cap. */
const readyFixture = async (
  homeDir: string,
): Promise<{ ctx: CliContext; fixture: FixtureRepo; stderr: string[]; stdout: string[] }> => {
  const { ctx, stderr, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ tags: ['v1.0.0'] });
  stderr.length = 0;
  stdout.length = 0;
  return { ctx, fixture, stderr, stdout };
};

describe('refs add --dry-run: stderr progress (--json mode)', () => {
  it(
    'emits cloning/detecting progress on stderr while stdout stays exactly one envelope',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, fixture, stderr, stdout } = await readyFixture(homeDir);

          await run(ctx, ['node', 'refs', 'add', fixture.url, '--dry-run', '--json']);

          expect(stdout).toHaveLength(JSON_MODE_STDOUT_LINES);
          const envelope = parseLastEnvelope(stdout) as { ok: boolean };
          expect(envelope.ok).toBe(true);
          expect(stderr.some((line) => CLONE_LINE_PATTERN.test(line))).toBe(true);
          expect(stderr).toContain(DETECT_LINE);
          expect(stderr.some((line) => NPM_LINE_PATTERN.test(line))).toBe(false);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --dry-run: stderr progress (human mode)', () => {
  it(
    'emits the same cloning/detecting progress on stderr while stdout stays the human lines',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, fixture, stderr, stdout } = await readyFixture(homeDir);

          await run(ctx, ['node', 'refs', 'add', fixture.url, '--dry-run']);

          expect(stdout).toHaveLength(HUMAN_MODE_STDOUT_LINES);
          expect(stdout[FIRST_LINE]).toMatch(/^refs add: dry-run proposal ready for /u);
          expect(stderr.some((line) => CLONE_LINE_PATTERN.test(line))).toBe(true);
          expect(stderr).toContain(DETECT_LINE);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add: npm: source resolution progress', () => {
  it('emits the npm-resolution progress line before the registry fetch', async () => {
    expect.hasAssertions();
    const { ctx, stderr } = testContext();
    ctx.fetcher = () =>
      Promise.resolve({
        json: () =>
          Promise.resolve({ repository: { url: 'git+https://github.com/example/demo.git' } }),
        status: HTTP_STATUS_OK,
      });

    await resolveAddSource(ctx, 'npm:demo');

    expect(stderr).toContain("refs: resolving npm package 'demo'…");
  });
});
