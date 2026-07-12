import {
  ALPHA_MATCHES,
  DIST_MATCH,
  NESTED_DIST_MATCH,
  PKG_MATCH,
  SEARCH_PACKAGE_NAME,
  SEARCH_REF_KEY,
  UTF8_MATCH,
  expectedSearchData,
  parseSoleSearchEnvelope,
  runSearchCli,
  setupSearchFixture,
} from '../helpers/search-support.ts';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { EXIT } from '@kaisers-io/refs-core';

// Integration suite for `refs search`, against a real git fixture committed directly at the
// ref's checkout path (see `search-support.ts` — `git grep` only searches tracked files). Test
// case labels (a)-(g) mirror the task brief's coverage list. The command is driven through the
// registry-built program (`search` is registered via `registrars-extra.ts`). Every case builds
// a real git fixture in setup, so each `it` gets the same generous per-test timeout
// `tag.test.ts` uses for its own real-git cases.
const TEST_TIMEOUT_MS = 30_000;
const FIRST_INDEX = 0;
const LIMIT_TWO = 2;
const HUMAN_LINE_COUNT = 3;
const LAST_INDEX = -1;

describe('refs search: happy path', () => {
  it(
    '(a) returns bounded structured matches with the default excludes applied',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_alpha', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          // An unscoped search reports an explicit `package: null` (baked into the helper's
          // Default payload), mirroring `range`/`resolve` — never a dropped key.
          expect(envelope.data).toStrictEqual(expectedSearchData('needle_alpha', ALPHA_MATCHES));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: --limit truncation', () => {
  it(
    '(b) caps matches at --limit and flags truncation when more matches exist',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_alpha', '--limit', '2', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_alpha', ALPHA_MATCHES.slice(FIRST_INDEX, LIMIT_TWO), {
              truncated: true,
            }),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(b2) human output prints path:line: snippet rows and a summary that mentions truncation',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_alpha', '--limit', '2']);

          expect(stdout).toHaveLength(HUMAN_LINE_COUNT);
          expect(stdout[FIRST_INDEX]).toBe("src/alpha.ts:1: const alpha1 = 'needle_alpha';");
          expect(stdout.at(LAST_INDEX)).toMatch(/truncated/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: default excludes', () => {
  it(
    '(c) a needle that only lives under dist/ is filtered by the default excludes',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_dist', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(expectedSearchData('needle_dist', []));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(d) --no-default-excludes finds the dist/ needle and reports an empty excludes_applied',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_dist',
            '--no-default-excludes',
            '--json',
          ]);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_dist', [DIST_MATCH], { excludes_applied: [] }),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: nested default excludes', () => {
  it(
    '(c2) a needle under a NESTED dist/ is filtered by default (glob magic, not root-only)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_nested', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(expectedSearchData('needle_nested', []));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(d2) --no-default-excludes finds the nested dist/ needle',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_nested',
            '--no-default-excludes',
            '--json',
          ]);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_nested', [NESTED_DIST_MATCH], { excludes_applied: [] }),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: non-ASCII paths', () => {
  it(
    '(c3) a match in a non-ASCII file name reports the real path, not an octal-escaped one',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_utf8', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(expectedSearchData('needle_utf8', [UTF8_MATCH]));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: --package scoping', () => {
  it(
    "(e) --package restricts matches to the named package's path (the same needle in another package stays hidden)",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_scoped',
            '--package',
            SEARCH_PACKAGE_NAME,
            '--json',
          ]);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_scoped', [PKG_MATCH], { package: SEARCH_PACKAGE_NAME }),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: no matches', () => {
  it(
    '(f) a pattern with no matches succeeds with an empty, untruncated result',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_absent', '--json']);

          expect(process.exitCode).toBeUndefined();
          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(expectedSearchData('needle_absent', []));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: invalid ref', () => {
  it(
    '(g) an unresolvable ref exits 4 (not_found)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, ['github.com/acme/nope', 'needle_alpha', '--json']);

          expect(process.exitCode).toBe(EXIT.NOT_FOUND);
          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('not_found');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
