import { EXIT, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { FakeRunner, RefsHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig, seedState } from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { matchRefKey } from '../../src/commands/list.ts';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// CLI-wiring + unit tests for `refs show` and the `matchRefKey` suffix matcher it (and future
// Tasks 18-22 commands) rely on. Config/state are seeded directly via `writeConfig`/`writeState`.
// The `--packages`/`--tags` json opt-ins live in `show-payload.test.ts` (300-line cap).

const NEXTJS_KEY = 'github.com/vercel/next.js';
const MIRROR_NEXTJS_KEY = 'corp-mirror/github.com/vercel/next.js';
const OTHER_NEXTJS_KEY = 'gitlab.com/acme/next.js';
const TAGS = ['v5.0.0', 'v4.0.0', 'v3.0.0', 'v2.0.0', 'v1.1.0', 'v1.0.0'];
const FIVE_TAGS = 5;
const FIRST_INDEX = 0;
const SHA_LENGTH = 40;
const NO_CALLS = 0;
const SAMPLE_SHA = '0'.repeat(SHA_LENGTH);
const GIT_TAG_FAILURE_EXIT_CODE = 128;
const ONE_WARNING = 1;

const NEXTJS_ENTRY = {
  default_branch: 'canary',
  description: 'The React Framework',
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};
const OTHER_NEXTJS_ENTRY = {
  default_branch: 'main',
  description: 'A fork',
  tag_format: 'v{version}',
  url: 'https://gitlab.com/acme/next.js',
};
const MIRROR_NEXTJS_ENTRY = {
  default_branch: 'canary',
  description: 'Corp mirror of the React Framework',
  tag_format: 'v{version}',
  url: 'https://corp-mirror.example.com/github.com/vercel/next.js',
};

type ErrorEnvelope = {
  error?: { code: string; message: string };
  ok: boolean;
};

const parseSoleEnvelope = (stdout: readonly string[]): { data: unknown; ok: boolean } => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as { data: unknown; ok: boolean };
};

const expectUsageErrorListing = (
  stdout: readonly string[],
  candidates: readonly string[],
): void => {
  expect(process.exitCode).toBe(EXIT.USAGE);
  const envelope = parseSoleEnvelope(stdout) as ErrorEnvelope;
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe('usage');
  for (const candidate of candidates) {
    expect(envelope.error?.message).toContain(candidate);
  }
};

const expectNotFound = (stdout: readonly string[]): void => {
  expect(process.exitCode).toBe(EXIT.NOT_FOUND);
  const envelope = parseSoleEnvelope(stdout) as ErrorEnvelope;
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe('not_found');
};

/** Seeds `next.js` (with a fetched `head_sha`) and a present checkout scripted to return `TAGS` on
 * `git tag` — the common fixture for the "full data via suffix match" test, split out purely to
 * keep that test's own statement count under the repo's `max-statements` cap. */
const seedNextjsWithTags = async (home: RefsHome, runner: FakeRunner): Promise<string> => {
  await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });
  await seedState(home, { [NEXTJS_KEY]: { head_sha: SAMPLE_SHA } });
  const dest = checkoutPath(home, zRefKey.parse(NEXTJS_KEY));
  await markCheckoutPresent(dest);
  runner.expect('git tag', { stdout: TAGS.join('\n') });
  return dest;
};

describe('refs show: matchRefKey suffix resolution', () => {
  it('matches a unique suffix on segment boundaries, and the full key itself', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = testContext();
      ctx.env['REFS_HOME'] = homeDir;
      const home = resolveHome(ctx.env);
      const config = await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });

      expect(matchRefKey(config, 'next.js')).toBe(NEXTJS_KEY);
      expect(matchRefKey(config, 'vercel/next.js')).toBe(NEXTJS_KEY);
      expect(matchRefKey(config, NEXTJS_KEY)).toBe(NEXTJS_KEY);
    });
  });
});

describe('refs show: matchRefKey exact full-key match wins over an ambiguous suffix', () => {
  it('resolves the literal full key even when it is also a suffix of another configured key', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = testContext();
      ctx.env['REFS_HOME'] = homeDir;
      const home = resolveHome(ctx.env);
      const config = await seedConfig(home, {
        [NEXTJS_KEY]: NEXTJS_ENTRY,
        [MIRROR_NEXTJS_KEY]: MIRROR_NEXTJS_ENTRY,
      });

      expect(matchRefKey(config, NEXTJS_KEY)).toBe(NEXTJS_KEY);
      expect(() => matchRefKey(config, 'vercel/next.js')).toThrow(/matches more than one ref/u);
    });
  });
});

describe('refs show: matchRefKey rejects a non-boundary partial segment', () => {
  it('throws not_found for "js" against next.js', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = testContext();
      ctx.env['REFS_HOME'] = homeDir;
      const home = resolveHome(ctx.env);
      const config = await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });

      expect(() => matchRefKey(config, 'js')).toThrow(/no ref matches/u);
    });
  });
});

describe('refs show: full data via suffix match', () => {
  it('includes the entry, state, local_path, and up to 5 sample tags', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        const dest = await seedNextjsWithTags(home, runner);

        await run(ctx, ['node', 'refs', 'show', 'next.js', '--json', '--tags']);

        const envelope = parseSoleEnvelope(stdout) as {
          data: {
            description: string;
            key: string;
            local_path: string;
            sample_tags: string[];
            state: { head_sha?: string };
            url: string;
          };
        };
        expect(envelope.data).toMatchObject({
          description: 'The React Framework',
          key: NEXTJS_KEY,
          local_path: dest,
          sample_tags: TAGS.slice(FIRST_INDEX, FIVE_TAGS),
          state: { head_sha: SAMPLE_SHA },
          url: 'https://github.com/vercel/next.js',
        });
      }),
    );
  });
});

describe('refs show: missing checkout', () => {
  it('returns no sample tags and never shells out', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });

        await run(ctx, ['node', 'refs', 'show', NEXTJS_KEY, '--json', '--tags']);

        const envelope = parseSoleEnvelope(stdout) as { data: { sample_tags: string[] } };
        expect(envelope.data.sample_tags).toStrictEqual([]);
        expect(runner.calls).toHaveLength(NO_CALLS);
      }),
    );
  });
});

/** Seeds `next.js` with a present-but-broken checkout: `.git` exists (so `isGitCheckout` passes)
 * but the scripted `git tag` call fails (non-zero exit), simulating a corrupt/detached checkout —
 * split out purely to keep the test below under the repo's `max-statements` cap. */
const seedNextjsWithBrokenGitTag = async (home: RefsHome, runner: FakeRunner): Promise<void> => {
  await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });
  const dest = checkoutPath(home, zRefKey.parse(NEXTJS_KEY));
  await markCheckoutPresent(dest);
  runner.expect('git tag', {
    exitCode: GIT_TAG_FAILURE_EXIT_CODE,
    stderr: 'fatal: not a git repository (or any of the parent directories): .git',
  });
};

describe('refs show: present but corrupt checkout', () => {
  it('degrades sample_tags to [] and reports a warning instead of failing', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedNextjsWithBrokenGitTag(home, runner);

        await run(ctx, ['node', 'refs', 'show', NEXTJS_KEY, '--json', '--tags']);

        expect(process.exitCode).toBeUndefined();
        const envelope = parseSoleEnvelope(stdout) as {
          data: { sample_tags: string[] };
          ok: boolean;
          warnings: string[];
        };
        expect(envelope).toMatchObject({ data: { sample_tags: [] }, ok: true });
        expect(envelope.warnings).toHaveLength(ONE_WARNING);
        expect(envelope.warnings[FIRST_INDEX]).toContain('could not list tags');
      }),
    );
  });
});

describe('refs show: ambiguous suffix', () => {
  it('exits 2 (usage) and lists both candidates', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, {
          [NEXTJS_KEY]: NEXTJS_ENTRY,
          [OTHER_NEXTJS_KEY]: OTHER_NEXTJS_ENTRY,
        });

        await run(ctx, ['node', 'refs', 'show', 'next.js', '--json']);

        expectUsageErrorListing(stdout, [NEXTJS_KEY, OTHER_NEXTJS_KEY]);
      }),
    );
  });
});

describe('refs show: no match', () => {
  it('exits 4 (not_found)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });

        await run(ctx, ['node', 'refs', 'show', 'nonexistent', '--json']);

        expectNotFound(stdout);
      }),
    );
  });
});

describe('refs show: human mode', () => {
  it('prints ref, description, url, and path', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });

        await run(ctx, ['node', 'refs', 'show', 'next.js']);

        expect(stdout[FIRST_INDEX]).toBe(`ref: ${NEXTJS_KEY}`);
        expect(stdout).toContain('description: The React Framework');
        expect(stdout).toContain('url: https://github.com/vercel/next.js');
        expect(stdout).toContain(`path: ${checkoutPath(home, zRefKey.parse(NEXTJS_KEY))}`);
      }),
    );
  });
});
