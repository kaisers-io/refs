import {
  PACKAGE_NAME,
  REF_KEY,
  parseSoleEnvelope,
  setupEditFixture,
} from '../helpers/edit-support.ts';
import { describe, expect, it } from 'vitest';
import { readConfig, resolveHome } from '@kaisers-io/refs-core';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { run } from '../../src/main.ts';

// Review-finding regression tests for `refs edit`'s `{key, field, old, new}` envelope shape —
// split out of `edit.test.ts` purely to keep it under the repo's 300-line oxlint cap (mirrors
// that file's own split from `edit-url.test.ts`). Covers:
//   - Finding 1: `old`/`new` must normalize an unset optional field to `null`, never `undefined`
//     (which `JSON.stringify` would silently drop from the envelope), and human mode must render
//     that as `'(unset)'` rather than the literal string `'undefined'`/`'null'`.
//   - Finding 4: setting a package field (`tag_format`) that a package never had is a valid
//     creation-on-edit — the whole-entry re-validation in `edit-package.ts` accepts it, and the
//     resulting envelope's `old` ties directly into Finding 1's `null` normalization.
const TEST_TIMEOUT_MS = 30_000;

describe('refs edit: unset optional field envelope (Finding 1)', () => {
  it(
    '(j) editing an unset ref settings-override field reports old as null, not omitted',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, ['node', 'refs', 'edit', REF_KEY, 'clone_mode', 'full', '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data?.field).toBe('clone_mode');
          expect(envelope.data?.new).toBe('full');
          expect(envelope.data?.old).toBeNull();
          // Guards against the literal bug: `JSON.stringify` drops an `undefined` object value
          // entirely, so `old` would vanish from the serialized line rather than read as `null`.
          const [line] = stdout;
          expect(line).toContain('"old":null');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(k) editing an unset ref settings-override field in human mode renders (unset)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixture(homeDir);

          await run(ctx, ['node', 'refs', 'edit', REF_KEY, 'clone_mode', 'full']);

          expect(stdout).toStrictEqual([`${REF_KEY}: clone_mode '(unset)' -> 'full'`]);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: package field creation-on-edit (Finding 4)', () => {
  it(
    '(l) setting tag_format on a package that never had one creates it (old: null)',
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
            'tag_format',
            'v{version}',
            '--package',
            PACKAGE_NAME,
            '--json',
          ]);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data?.new).toBe('v{version}');
          expect(envelope.data?.old).toBeNull();
          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          expect(config.refs[REF_KEY]?.packages?.[PACKAGE_NAME]?.tag_format).toBe('v{version}');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
