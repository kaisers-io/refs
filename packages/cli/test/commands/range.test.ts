import {
  PACKAGE_NAME,
  REF_KEY,
  UNKNOWN_PACKAGE_NAME,
  parseSoleEnvelope,
  runRangeCli,
  setupRangeFixture,
  setupRangeFixtureNoCheckout,
} from '../helpers/range-support.ts';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { EXIT } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { RangeEnvelope } from '../helpers/range-support.ts';

// Integration suite for `refs range`, against the real two-tag git fixture built by
// `range-support.ts` (v1.0.0 → CHANGELOG commit → packages/pkg commit → v2.0.0). Drives the
// command through `runRangeCli` (the registry-built program — `registerRange` is wired in via
// `registrars-extra.ts`) with the same temp-home/exit-code hygiene as `tag.test.ts`.
// Assertion bundles live in module-level helpers to respect the per-test expect cap. Every case
// clones a real fixture, so each `it` gets the same generous per-test timeout the other real-git
// suites use.

const TEST_TIMEOUT_MS = 30_000;
const RANGE_COMMITS = 2;
const SINGLE = 1;

type RangeData = RangeEnvelope['data'];

const expectHappyIdentity = (envelope: RangeEnvelope): void => {
  expect(envelope.ok).toBe(true);
  expect(envelope.data?.key).toBe(REF_KEY);
  expect(envelope.data?.package).toBeNull();
  expect(envelope.data?.old).toStrictEqual({ tag: 'v1.0.0', version: '1.0.0' });
  expect(envelope.data?.new).toStrictEqual({ tag: 'v2.0.0', version: '2.0.0' });
};

const expectHappyDigest = (data: RangeData): void => {
  expect(data?.commit_count).toBe(RANGE_COMMITS);
  expect(data?.commits.map((commit) => commit.subject)).toStrictEqual([
    'pkg change',
    'add changelog',
  ]);
  expect(data?.diff.files_changed).toBe(RANGE_COMMITS);
  expect(data?.changed_paths).toStrictEqual([
    { path: 'CHANGELOG.md', status: 'A' },
    { path: `packages/${PACKAGE_NAME}/index.txt`, status: 'A' },
  ]);
  expect(data?.truncated).toStrictEqual({ changelog: false, commits: false, paths: false });
};

// The excerpt must cover exactly the 2.0.0 section — up to, and excluding, the 1.0.0 heading.
const expectHappyChangelog = (data: RangeData): void => {
  expect(data?.changelog).toContain('Added feature X');
  expect(data?.changelog).not.toContain('Initial release');
};

const expectPackageTags = (envelope: RangeEnvelope): void => {
  expect(envelope.ok).toBe(true);
  expect(envelope.data?.package).toBe(PACKAGE_NAME);
  expect(envelope.data?.old.tag).toBe('pkg@1.0.0');
  expect(envelope.data?.new.tag).toBe('pkg@2.0.0');
  // The commit log stays repo-wide — only the diff queries are path-scoped.
  expect(envelope.data?.commit_count).toBe(RANGE_COMMITS);
};

const expectPackageScopedDiff = (data: RangeData): void => {
  expect(data?.diff.files_changed).toBe(SINGLE);
  expect(data?.changed_paths).toStrictEqual([
    { path: `packages/${PACKAGE_NAME}/index.txt`, status: 'A' },
  ]);
  // No packages/pkg/CHANGELOG.md exists at the tag — the repo-root fallback must kick in.
  expect(data?.changelog).toContain('Added feature X');
};

const expectNotFound = (stdout: readonly string[], messagePattern?: RegExp): void => {
  expect(process.exitCode).toBe(EXIT.NOT_FOUND);
  const envelope = parseSoleEnvelope(stdout);
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe('not_found');
  if (messagePattern !== undefined) {
    expect(envelope.error?.message).toMatch(messagePattern);
  }
};

describe('refs range: ref-level happy path', () => {
  it(
    '(a) emits one envelope with tags, commits, diff, paths, changelog, and truncation flags',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixture(homeDir);

          await runRangeCli(ctx, [REF_KEY, '1.0.0', '2.0.0', '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expectHappyIdentity(envelope);
          expectHappyDigest(envelope.data);
          expectHappyChangelog(envelope.data);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(a2) human mode prints the summary lines instead of an envelope',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixture(homeDir);

          await runRangeCli(ctx, [REF_KEY, '1.0.0', '2.0.0']);

          expect(stdout).toStrictEqual([
            `${REF_KEY}: v1.0.0 -> v2.0.0`,
            'commits: 2 (showing 2)',
            expect.stringContaining('files changed: 2 (+'),
            'changelog: found',
          ]);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs range: --package scoping', () => {
  it(
    "(b) resolves via the package's tag_format and scopes diff/paths to its path",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixture(homeDir);

          await runRangeCli(ctx, [REF_KEY, '1.0.0', '2.0.0', '--package', PACKAGE_NAME, '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expectPackageTags(envelope);
          expectPackageScopedDiff(envelope.data);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs range: --limit truncation', () => {
  it(
    '(c) bounds commits to --limit and raises truncated.commits',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixture(homeDir);

          await runRangeCli(ctx, [REF_KEY, '1.0.0', '2.0.0', '--limit', '1', '--json']);

          const { data, ok } = parseSoleEnvelope(stdout);
          expect(ok).toBe(true);
          expect(data?.commit_count).toBe(RANGE_COMMITS);
          expect(data?.commits.map((commit) => commit.subject)).toStrictEqual(['pkg change']);
          expect(data?.truncated).toStrictEqual({ changelog: false, commits: true, paths: false });
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs range: no changelog in the repo', () => {
  it(
    '(d) reports changelog: null (with truncated.changelog false) instead of failing',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixture(homeDir, { withChangelog: false });

          await runRangeCli(ctx, [REF_KEY, '1.0.0', '2.0.0', '--json']);

          const { data, ok } = parseSoleEnvelope(stdout);
          expect(ok).toBe(true);
          expect(data?.changelog).toBeNull();
          expect(data?.commit_count).toBe(SINGLE);
          expect(data?.truncated.changelog).toBe(false);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs range: missing tag', () => {
  it(
    '(e) a version with no matching tag exits 4 (not_found)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixture(homeDir);

          await runRangeCli(ctx, [REF_KEY, '1.0.0', '9.9.9', '--json']);

          expectNotFound(stdout, /check the version or tag_format/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs range: unknown --package', () => {
  it(
    '(f) an unregistered package name exits 4 (not_found)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixture(homeDir);

          await runRangeCli(ctx, [
            REF_KEY,
            '1.0.0',
            '2.0.0',
            '--package',
            UNKNOWN_PACKAGE_NAME,
            '--json',
          ]);

          expectNotFound(stdout);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs range: missing checkout', () => {
  it(
    '(g) a configured ref whose checkout is missing exits 4 (not_found), naming refs sync',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupRangeFixtureNoCheckout(homeDir);

          await runRangeCli(ctx, [REF_KEY, '1.0.0', '2.0.0', '--json']);

          expectNotFound(stdout, /refs sync/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
