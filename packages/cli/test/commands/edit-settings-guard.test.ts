import { EXIT, readConfig, resolveHome } from '@kaisers-io/refs-core';
import {
  PACKAGE_NAME,
  SETTINGS_SUFFIX_REF_KEY,
  parseSoleEnvelope,
  setupEditFixture,
  setupEditFixtureWithSettingsSuffixRef,
} from '../helpers/edit-support.ts';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { run } from '../../src/main.ts';

// Review-finding regression tests for `refs edit settings ...`'s reserved-word dispatch — split
// out of `edit.test.ts` purely to keep it under the repo's 300-line oxlint cap (mirrors that
// file's own split from `edit-url.test.ts`). Covers:
//   - Finding 2: 'settings' always wins the dispatch over a same-suffix-matching ref
//     (deterministic by design — see `edit.ts`'s comment), but that silent wrong-target risk must
//     fail LOUD ENOUGH: the envelope's `warnings` names the shadowed ref.
//   - Finding 3: `--package` is only meaningful for ref/package edits — passing it in settings
//     mode must be a usage error, not a silently ignored option.
const TEST_TIMEOUT_MS = 30_000;
const SINGLE_WARNING_COUNT = 1;
const FIRST_WARNING_INDEX = 0;

/** Asserts the `refs edit settings sync_ttl 2h` envelope carries exactly one collision warning
 * naming `SETTINGS_SUFFIX_REF_KEY`, and that the write landed on global settings (not that ref) —
 * split out of the `it` body purely to keep it under the repo's `max-statements`/`max-expects`
 * oxlint caps, mirroring `edit-url.test.ts`'s `assertUrlRewritten`. */
const assertSettingsCollisionWarning = async (
  ctx: CliContext,
  stdout: readonly string[],
): Promise<void> => {
  const envelope = parseSoleEnvelope(stdout);
  expect(envelope.ok).toBe(true);
  expect(envelope.data).toStrictEqual({
    field: 'sync_ttl',
    key: 'settings',
    new: '2h',
    old: '1h',
  });
  expect(envelope.warnings).toHaveLength(SINGLE_WARNING_COUNT);
  expect(envelope.warnings?.[FIRST_WARNING_INDEX]).toContain(SETTINGS_SUFFIX_REF_KEY);
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  expect(config.settings.sync_ttl).toBe('2h');
};

describe('refs edit: settings/ref suffix collision (Finding 2)', () => {
  it(
    '(m) settings mode warns when a configured ref also matches the settings suffix',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixtureWithSettingsSuffixRef(homeDir);

          await run(ctx, ['node', 'refs', 'edit', 'settings', 'sync_ttl', '2h', '--json']);

          await assertSettingsCollisionWarning(ctx, stdout);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(n) settings mode carries no warning when no ref matches the settings suffix',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, ['node', 'refs', 'edit', 'settings', 'sync_ttl', '2h', '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.warnings).toStrictEqual([]);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

// Micro-fix round 2: the collision warning above only ever proved out over `--json` — in human
// mode `emit` used to serialize warnings solely into the (never-printed) json envelope, so this
// same note silently never reached the user. Split into its own `describe` purely to keep the
// block above under the repo's `max-lines-per-function` oxlint cap.
describe('refs edit: settings/ref suffix collision warning reaches human-mode stderr', () => {
  it(
    '(m2) settings mode in human mode writes the collision note to stderr, not stdout',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stderr, stdout } = await setupEditFixtureWithSettingsSuffixRef(homeDir);

          await run(ctx, ['node', 'refs', 'edit', 'settings', 'sync_ttl', '2h']);

          expect(stdout).toStrictEqual(["settings: sync_ttl '1h' -> '2h'"]);
          expect(stderr).toHaveLength(SINGLE_WARNING_COUNT);
          expect(stderr[FIRST_WARNING_INDEX]).toMatch(/^refs: warning: /u);
          expect(stderr[FIRST_WARNING_INDEX]).toContain(SETTINGS_SUFFIX_REF_KEY);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: settings mode rejects --package (Finding 3)', () => {
  it(
    '(o) --package with settings mode exits 2 (usage) and leaves settings untouched',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, [
            'node',
            'refs',
            'edit',
            'settings',
            'sync_ttl',
            '2h',
            '--package',
            PACKAGE_NAME,
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.USAGE);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('usage');
          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          expect(config.settings.sync_ttl).toBe('1h');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
