import { EXIT, checkoutPath, readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import {
  REF_ENTRY,
  REF_KEY,
  parseSoleEnvelope,
  setupEditFixture,
  setupEditFixtureWithCheckout,
} from '../helpers/edit-support.ts';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { execa } from 'execa';
import { join } from 'node:path';
import { relocateBehindSymlink } from '../helpers/add-guards-support.ts';
import { run } from '../../src/main.ts';

// `refs edit <ref> url <value>` cases (e)/(f) from the task brief's Step 1 list — split out of
// `edit.test.ts` purely to keep both files under the repo's 300-line oxlint cap. Case (e) clones a
// real fixture into the ref's checkout path and shells out for real (needs the generous per-test
// timeout `tag.test.ts`/`add.test.ts`/`sync.test.ts` use for their own real-git cases); case (f)
// never reaches the checkout (the key-mismatch check runs first), so it stays on the plain,
// non-git fixture. The containment case at the bottom closes the same symlinked-ancestor class
// the add/sync/finalize guards cover: `git remote set-url` writes `.git/config`, so it must never
// run against a checkout that physically lives outside sources/.
const TEST_TIMEOUT_MS = 30_000;

/** Asserts the `refs edit ... url <newUrl>` envelope, the persisted config, and the real checkout's
 * rewritten `origin` remote — split out of the `it` body purely to keep it under the repo's
 * `max-statements` oxlint cap. */
const assertUrlRewritten = async (
  ctx: CliContext,
  stdout: readonly string[],
  newUrl: string,
): Promise<void> => {
  const envelope = parseSoleEnvelope(stdout);
  expect(envelope.ok).toBe(true);
  expect(envelope.data).toStrictEqual({
    field: 'url',
    key: REF_KEY,
    new: newUrl,
    old: REF_ENTRY.url,
  });
  const home = resolveHome(ctx.env);
  const config = await readConfig(home);
  expect(config.refs[REF_KEY]?.url).toBe(newUrl);
  const dest = checkoutPath(home, zRefKey.parse(REF_KEY));
  const remote = await execa('git', ['remote', 'get-url', 'origin'], { cwd: dest });
  expect(remote.stdout.trim()).toBe(newUrl);
};

describe('refs edit: url, same key', () => {
  it(
    '(e) editing url to a cosmetic variant of the same repo rewrites the git remote',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixtureWithCheckout(homeDir);
          const newUrl = 'https://github.com/acme/widget.git';

          await run(ctx, ['node', 'refs', 'edit', REF_KEY, 'url', newUrl, '--json']);

          await assertUrlRewritten(ctx, stdout, newUrl);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs edit: url, different key', () => {
  it(
    '(f) editing url to a different repo exits 3 (validation)',
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
            'url',
            'https://github.com/acme/other-widget',
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('validation');
          expect(envelope.error?.message).toMatch(/derives a different key/u);
          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          expect(config.refs[REF_KEY]?.url).toBe(REF_ENTRY.url);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

/** Asserts the failed-closed shape of the containment case: validation exit with the containment
 * message, the OLD url still in config (the edit must abort before `writeConfig`, or config and
 * the never-rewritten remote would silently diverge), and the outside checkout's `origin` remote
 * byte-for-byte unchanged. Split out of the `it` body purely to keep it under the repo's
 * `max-statements` oxlint cap. */
const assertEditRefusedUntouched = async (
  ctx: CliContext,
  stdout: readonly string[],
  opts: { dest: string; originBefore: string },
): Promise<void> => {
  expect(process.exitCode).toBe(EXIT.VALIDATION);
  const envelope = parseSoleEnvelope(stdout);
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.message).toMatch(/containment/u);
  const config = await readConfig(resolveHome(ctx.env));
  expect(config.refs[REF_KEY]?.url).toBe(REF_ENTRY.url);
  const originAfter = await execa('git', ['remote', 'get-url', 'origin'], { cwd: opts.dest });
  expect(originAfter.stdout).toBe(opts.originBefore);
};

describe('refs edit: url, containment guard', () => {
  it(
    'refuses to rewrite the remote (and writes nothing to config) when the checkout lives outside sources/ behind a symlinked ancestor',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupEditFixtureWithCheckout(homeDir);
          const home = resolveHome(ctx.env);
          const relocated = await relocateBehindSymlink(join(home.sourcesDir, 'github.com'));
          const dest = join(relocated, 'acme', 'widget');
          const originBefore = await execa('git', ['remote', 'get-url', 'origin'], { cwd: dest });

          await run(ctx, [
            'node',
            'refs',
            'edit',
            REF_KEY,
            'url',
            `${REF_ENTRY.url}.git`,
            '--json',
          ]);

          await assertEditRefusedUntouched(ctx, stdout, {
            dest,
            originBefore: originBefore.stdout,
          });
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
