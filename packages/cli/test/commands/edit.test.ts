import { EXIT, readConfig, resolveHome } from '@kaisers-io/refs-core';
import {
  PACKAGE_NAME,
  REF_KEY,
  UNKNOWN_PACKAGE_NAME,
  parseSoleEnvelope,
  setupEditFixture,
} from '../helpers/edit-support.ts';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { run } from '../../src/main.ts';

// Integration suite for `refs edit`'s settings/ref/package (non-url) modes, against config seeded
// directly via `seedConfig` (`writeConfig`) — see `edit-support.ts` for the shared fixture. Case
// labels (a)-(d), (g), (h) mirror the task brief's Step 1 list; (i) covers one more branch the
// contract documents but the brief's list doesn't enumerate (an unregistered `--package` name).
// The `url`-editing cases (e)/(f) live in `edit-url.test.ts` — split out purely to keep this file
// under the repo's 300-line oxlint cap, per the task brief's up-front three-mode plan.
const TEST_TIMEOUT_MS = 30_000;

describe('refs edit settings: happy path', () => {
  it(
    '(a) settings sync_ttl 2h persists the new duration',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, ['node', 'refs', 'edit', 'settings', 'sync_ttl', '2h', '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual({
            field: 'sync_ttl',
            key: 'settings',
            new: '2h',
            old: '1h',
          });
          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          expect(config.settings.sync_ttl).toBe('2h');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit settings: invalid value', () => {
  it(
    '(b) a bogus setting value exits 3 (validation)',
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
            'not-a-duration',
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('validation');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: ref field', () => {
  it(
    '(c) editing a top-level ref field persists the new value',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, [
            'node',
            'refs',
            'edit',
            REF_KEY,
            'description',
            'A widget, edited',
            '--json',
          ]);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual({
            field: 'description',
            key: REF_KEY,
            new: 'A widget, edited',
            old: 'Widget',
          });
          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          expect(config.refs[REF_KEY]?.description).toBe('A widget, edited');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: package field', () => {
  it(
    '(d) editing a package field via --package persists the new value',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, [
            'node',
            'refs',
            'edit',
            REF_KEY,
            'description',
            'Edited package',
            '--package',
            PACKAGE_NAME,
            '--json',
          ]);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual({
            field: 'description',
            key: REF_KEY,
            new: 'Edited package',
            old: 'Widget package',
          });
          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          expect(config.refs[REF_KEY]?.packages?.[PACKAGE_NAME]?.description).toBe(
            'Edited package',
          );
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: unknown field', () => {
  it(
    '(g) an unrecognized field exits 2 (usage)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, ['node', 'refs', 'edit', REF_KEY, 'bogus_field', 'x', '--json']);

          expect(process.exitCode).toBe(EXIT.USAGE);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('usage');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: packages direct edit', () => {
  it(
    '(h) editing packages directly (without --package) exits 2 (usage)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, ['node', 'refs', 'edit', REF_KEY, 'packages', '{}', '--json']);

          expect(process.exitCode).toBe(EXIT.USAGE);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('usage');
          expect(envelope.error?.message).toMatch(/--package <name> <field> <value>/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: unknown --package', () => {
  it(
    '(i) an unregistered package name exits 4 (not_found)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, [
            'node',
            'refs',
            'edit',
            REF_KEY,
            'description',
            'x',
            '--package',
            UNKNOWN_PACKAGE_NAME,
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.NOT_FOUND);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('not_found');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
