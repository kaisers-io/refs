import {
  DASH_REF_KEY,
  parseSoleEnvelope,
  runRangeCli,
  setupDashRangeFixture,
} from '../helpers/range-support.ts';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { RangeEnvelope } from '../helpers/range-support.ts';

// Companion suite to `range.test.ts`: a full `refs range` happy path over a ref whose
// tag_format ('-v{version}') renders LEADING-DASH tags. Internally every git query must address
// them as `refs/tags/<tag>` behind `--end-of-options` — a bare '-v1.0.0..-v2.0.0' span would be
// parsed as an option and exit 129 — while the JSON envelope keeps the bare tag names.

const TEST_TIMEOUT_MS = 30_000;
const DASH_RANGE_COMMITS = 1;

const expectDashIdentity = (envelope: RangeEnvelope): void => {
  expect(envelope.ok).toBe(true);
  expect(envelope.data?.key).toBe(DASH_REF_KEY);
  // The user-facing tag fields stay bare — the refs/tags/ qualification is internal only.
  expect(envelope.data?.old).toStrictEqual({ tag: '-v1.0.0', version: '1.0.0' });
  expect(envelope.data?.new).toStrictEqual({ tag: '-v2.0.0', version: '2.0.0' });
  expect(envelope.data?.changelog).toBeNull();
};

const expectDashDigest = (envelope: RangeEnvelope): void => {
  expect(envelope.data?.commit_count).toBe(DASH_RANGE_COMMITS);
  expect(envelope.data?.commits.map((commit) => commit.subject)).toStrictEqual(['dash change']);
  expect(envelope.data?.diff.files_changed).toBe(DASH_RANGE_COMMITS);
  expect(envelope.data?.changed_paths).toStrictEqual([{ path: 'dash.txt', status: 'A' }]);
  expect(envelope.data?.truncated).toStrictEqual({
    changelog: false,
    commits: false,
    paths: false,
  });
};

describe('refs range: leading-dash tags', () => {
  it(
    'resolves a -v{version} tag_format and completes the full digest happy path',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupDashRangeFixture(homeDir);

          await runRangeCli(ctx, [DASH_REF_KEY, '1.0.0', '2.0.0', '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expectDashIdentity(envelope);
          expectDashDigest(envelope);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
