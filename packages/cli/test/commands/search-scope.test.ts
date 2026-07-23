import {
  BRACKETS_MATCH,
  BRACKETS_PACKAGE_NAME,
  COLON_MATCH,
  GHOST_PACKAGE_NAME,
  NEWLINE_MATCH,
  PKG_DOC_MATCH,
  ROOT_DOC_MATCH,
  SEARCH_PACKAGE_NAME,
  SEARCH_REF_KEY,
  expectedSearchData,
  parseSoleSearchEnvelope,
  runSearchCli,
  setupSearchFixture,
} from '../helpers/search-support.ts';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { EXIT } from '@kaisers-io/refs-core';

// Companion suite to `search.test.ts` (same fixture, split to respect the per-file line cap):
// pins the `--package`-as-boundary and `--glob`-as-plain-glob contracts plus delimiter-proof
// path parsing. Case labels continue search.test.ts's (a)-(g): (h) package+glob intersect, (i)
// glob wrapping, (j) a metacharacter package path stays literal, (k) pathspec magic in --glob is
// a usage error, (l) colon file names survive the `-z` parsing, (m) a package directory absent
// from the checkout is a clean not_found, (n) newline file names survive the NUL-token record
// walk. The traversal/containment guards continue as (o)-(r) in `search-guards.test.ts`.

const TEST_TIMEOUT_MS = 30_000;

describe('refs search: --package + --glob intersection', () => {
  it(
    '(h) --glob applies INSIDE the package: a root-level .md with the same needle stays hidden',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_docs',
            '--package',
            SEARCH_PACKAGE_NAME,
            '--glob',
            '*.md',
            '--json',
          ]);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_docs', [PKG_DOC_MATCH], { package: SEARCH_PACKAGE_NAME }),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: --glob wrapping', () => {
  it(
    '(i) an unscoped --glob is wrapped as a :(glob) pathspec (** crosses directories)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_docs', '--glob', '**/*.md', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_docs', [ROOT_DOC_MATCH, PKG_DOC_MATCH]),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: metacharacters in a configured package path', () => {
  it(
    '(j) --package with a br[a]ckets path matches the literal directory, never its glob expansion',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_brackets',
            '--package',
            BRACKETS_PACKAGE_NAME,
            '--json',
          ]);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          // The decoy `packages/brackets/decoy.ts` (what fnmatch would expand `br[a]ckets` to)
          // Must stay hidden; the returned path is re-anchored at the checkout root.
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_brackets', [BRACKETS_MATCH], {
              package: BRACKETS_PACKAGE_NAME,
            }),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: --glob rejects pathspec magic', () => {
  it(
    '(k) a --glob value starting with ":" exits 2 (usage)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_docs',
            '--glob',
            ':(glob)**/*.md',
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.USAGE);
          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('usage');
          expect(envelope.error?.message).toMatch(/plain glob pattern, not a git pathspec/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: package path missing from the checkout', () => {
  it(
    '(m) a registered package whose directory is absent exits 4 (not_found), naming refs sync',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_docs',
            '--package',
            GHOST_PACKAGE_NAME,
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.NOT_FOUND);
          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('not_found');
          expect(envelope.error?.message).toMatch(/refs sync/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: delimiter-bearing file names', () => {
  it(
    '(l) a match in a file name containing a colon reports the real path',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_colon', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(expectedSearchData('needle_colon', [COLON_MATCH]));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(n) a match in a file name containing a real newline reports the full path verbatim',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_newline', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          // A newline-splitting parser would drop the `src/li\n` prefix and report `ne.ts`.
          expect(envelope.data).toStrictEqual(
            expectedSearchData('needle_newline', [NEWLINE_MATCH]),
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
