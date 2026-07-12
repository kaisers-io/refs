import {
  ESCAPE_PACKAGE_NAME,
  ESCAPE_PACKAGE_PATH,
  SEARCH_REF_KEY,
  expectedSearchData,
  parseSoleSearchEnvelope,
  runSearchCli,
  setupSearchFixture,
} from '../helpers/search-support.ts';
import { EXIT, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { mkdir, symlink } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { join } from 'node:path';

// Boundary-guard companion to `search.test.ts`/`search-scope.test.ts` (same fixture, split to
// respect the per-file line cap), continuing their case labels: (o) a leading `../` glob and
// (p) a mid-pattern `a/../b` traversal are usage errors, (q) `..` INSIDE a segment (`a..b`)
// stays a legal glob, (r) a package directory that is a symlink pointing outside the checkout
// is a containment violation — git must never be spawned with an external cwd.

const TEST_TIMEOUT_MS = 30_000;

const GLOB_ESCAPE_MESSAGE = /inside the search root/u;

/** Runs a search with the given `--glob` and asserts the traversal usage-error envelope. */
const expectGlobRejected = async (glob: string): Promise<void> => {
  await withResetExitCode(() =>
    withTempHome(async (homeDir) => {
      const { ctx, stdout } = await setupSearchFixture(homeDir);
      await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_docs', '--glob', glob, '--json']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      const envelope = parseSoleSearchEnvelope(stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.code).toBe('usage');
      expect(envelope.error?.message).toMatch(GLOB_ESCAPE_MESSAGE);
    }),
  );
};

/** Plants the registered `escape` package directory as a symlink to a real directory OUTSIDE
 * the checkout — `existsSync` follows it, so only the physical containment guard can catch
 * it. */
const plantEscapeSymlink = async (ctx: CliContext, homeDir: string): Promise<void> => {
  const dest = checkoutPath(resolveHome(ctx.env), zRefKey.parse(SEARCH_REF_KEY));
  const outside = join(homeDir, 'outside-target');
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(dest, ESCAPE_PACKAGE_PATH));
};

describe('refs search: --glob rejects traversal out of the search root', () => {
  it.each(['../*', 'a/../b'])(
    '(o/p) --glob %j exits 2 (usage)',
    async (glob) => {
      expect.hasAssertions();
      await expectGlobRejected(glob);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("refs search: '..' inside a glob segment stays legal", () => {
  it(
    "(q) --glob 'a..b*' is accepted as a plain glob, never rejected as traversal",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);

          await runSearchCli(ctx, [SEARCH_REF_KEY, 'needle_docs', '--glob', 'a..b*', '--json']);

          const envelope = parseSoleSearchEnvelope(stdout);
          // No fixture file matches `a..b*` — the point is the clean empty result, never exit 2.
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual(expectedSearchData('needle_docs', []));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs search: symlinked package directory escaping the checkout', () => {
  it(
    '(r) a package path that physically resolves outside the checkout exits 3 (validation)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupSearchFixture(homeDir);
          await plantEscapeSymlink(ctx, homeDir);

          await runSearchCli(ctx, [
            SEARCH_REF_KEY,
            'needle_docs',
            '--package',
            ESCAPE_PACKAGE_NAME,
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseSoleSearchEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('validation');
          expect(envelope.error?.message).toMatch(/containment violation/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
