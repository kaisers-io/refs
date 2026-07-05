import { EXIT, SpawnRunner, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// Integration suite for `refs tag`, against a real `file://` git fixture cloned directly into the
// ref's checkout path (never through `refs add` — `tag` only ever reads via `resolveTag`/
// `tagExists`, so no managed-checkout marker is required, per the task brief). Test case labels
// (a)-(d) mirror the task brief's Step 1 list. Config is seeded directly via `seedConfig`
// (`writeConfig`), mirroring `list.test.ts`/`show.test.ts`. Every case below clones a real git
// fixture in setup — well under 5s alone, but not under the full-workspace parallel `pnpm check`
// load, so each `it` gets the same generous per-test timeout `add.test.ts`/`sync.test.ts` use for
// their own real-git cases.
const TEST_TIMEOUT_MS = 30_000;
const REF_KEY = 'github.com/acme/widget';
const PACKAGE_NAME = 'pkg';
const UNKNOWN_PACKAGE_NAME = 'nope';
// A package with no `tag_format` of its own — exercises the `pkg.tag_format ?? entry.tag_format`
// inheritance branch in `formatFor` (tag.ts), which resolves via the REF's own format instead.
const NO_FORMAT_PACKAGE_NAME = 'pkg-no-format';
const REF_ENTRY = {
  default_branch: 'main',
  description: 'Widget',
  packages: {
    [NO_FORMAT_PACKAGE_NAME]: {
      description: 'Widget package without its own tag_format',
      path: 'packages/pkg-no-format',
    },
    [PACKAGE_NAME]: {
      description: 'Widget package',
      path: 'packages/pkg',
      tag_format: 'pkg@{version}',
    },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/widget',
};
const FIXTURE_TAGS = ['v1.0.0', 'pkg@2.0.0'];

const CLONE_SUCCESS_EXIT_CODE = 0;
// Test-setup-only `SpawnRunner`, mirroring `add-guards-support.ts`'s own local `setupRunner`.
const setupRunner = new SpawnRunner();

interface TagEnvelope {
  data?: { key: string; ref_path: string; tag: string; version: string };
  error?: { code: string; message: string };
  ok: boolean;
}

const parseSoleEnvelope = (stdout: readonly string[]): TagEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as TagEnvelope;
};

/** Clones `fixtureDir` (a local fixture repo, seeded with `FIXTURE_TAGS`) directly into `dest` —
 * a real, unmanaged checkout with real tags, standing in for a `refs add`ed checkout without the
 * overhead of running the full add pipeline. */
const cloneFixtureInto = async (fixtureDir: string, dest: string): Promise<void> => {
  const result = await setupRunner.run('git', ['clone', '-q', fixtureDir, dest]);
  if (result.exitCode !== CLONE_SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git clone failed: ${result.stderr}`);
  }
};

interface TagFixture {
  ctx: CliContext;
  stdout: string[];
}

/** Bootstraps a fresh temp home, seeds `REF_KEY` (with a ref-level `v{version}` format and a
 * `pkg` package override, `pkg@{version}`), and clones a real tag-bearing fixture into its
 * checkout — the common setup every `refs tag` case below needs. */
const setupTagFixture = async (homeDir: string): Promise<TagFixture> => {
  const { ctx, stdout } = testContext();
  ctx.runner = new SpawnRunner();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  const fixture = await createFixtureRepo({ tags: FIXTURE_TAGS });
  const dest = checkoutPath(home, zRefKey.parse(REF_KEY));
  await cloneFixtureInto(fixture.dir, dest);
  await seedConfig(home, { [REF_KEY]: REF_ENTRY });
  return { ctx, stdout };
};

/** Seeds `REF_KEY` into a fresh temp home WITHOUT cloning anything into its checkout path — the
 * checkout stays missing, as if `refs add` registered the ref but its checkout directory was
 * later deleted. Used only by the "missing checkout" case below. */
const setupTagFixtureNoCheckout = async (homeDir: string): Promise<TagFixture> => {
  const { ctx, stdout } = testContext();
  ctx.runner = new SpawnRunner();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedConfig(home, { [REF_KEY]: REF_ENTRY });
  return { ctx, stdout };
};

describe('refs tag: ref-level tag_format', () => {
  it(
    "(a) resolves a version via the ref's own tag_format",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupTagFixture(homeDir);

          await run(ctx, ['node', 'refs', 'tag', REF_KEY, '1.0.0', '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual({
            key: REF_KEY,
            ref_path: 'refs/tags/v1.0.0',
            tag: 'v1.0.0',
            version: '1.0.0',
          });
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs tag: --package override', () => {
  it(
    "(b) resolves a version via the named package's own tag_format override",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupTagFixture(homeDir);

          await run(ctx, [
            'node',
            'refs',
            'tag',
            REF_KEY,
            '2.0.0',
            '--package',
            PACKAGE_NAME,
            '--json',
          ]);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual({
            key: REF_KEY,
            ref_path: 'refs/tags/pkg@2.0.0',
            tag: 'pkg@2.0.0',
            version: '2.0.0',
          });
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs tag: --package tag_format inheritance', () => {
  it(
    "(b2) a package without its own tag_format inherits the ref's tag_format",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupTagFixture(homeDir);

          await run(ctx, [
            'node',
            'refs',
            'tag',
            REF_KEY,
            '1.0.0',
            '--package',
            NO_FORMAT_PACKAGE_NAME,
            '--json',
          ]);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data).toStrictEqual({
            key: REF_KEY,
            ref_path: 'refs/tags/v1.0.0',
            tag: 'v1.0.0',
            version: '1.0.0',
          });
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs tag: missing version', () => {
  it(
    '(c) a version with no matching tag exits 4 (not_found)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupTagFixture(homeDir);

          await run(ctx, ['node', 'refs', 'tag', REF_KEY, '9.9.9', '--json']);

          expect(process.exitCode).toBe(EXIT.NOT_FOUND);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('not_found');
          expect(envelope.error?.message).toMatch(/check the version or tag_format/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs tag: unknown --package', () => {
  it(
    '(d) an unregistered package name exits 4 (not_found)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupTagFixture(homeDir);

          await run(ctx, [
            'node',
            'refs',
            'tag',
            REF_KEY,
            '1.0.0',
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

describe('refs tag: git revision syntax in version', () => {
  // Regression test for the literal-ref-verification fix: `1.0.0^{}` rendered through
  // `v{version}` used to peel against the real `v1.0.0` tag via `rev-parse --verify`'s revision
  // syntax support. `tagExists` now checks the literal ref, so this must not falsely resolve.
  it(
    '(e) a crafted version carrying git revision syntax exits 4 (not_found), not a false match',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupTagFixture(homeDir);

          await run(ctx, ['node', 'refs', 'tag', REF_KEY, '1.0.0^{}', '--json']);

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

describe('refs tag: missing checkout', () => {
  it(
    '(f) a configured ref whose checkout is missing exits 4 (not_found), naming refs sync',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupTagFixtureNoCheckout(homeDir);

          await run(ctx, ['node', 'refs', 'tag', REF_KEY, '1.0.0', '--json']);

          expect(process.exitCode).toBe(EXIT.NOT_FOUND);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('not_found');
          expect(envelope.error?.message).toMatch(/refs sync/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
