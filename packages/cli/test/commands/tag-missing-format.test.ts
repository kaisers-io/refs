import { EXIT, SpawnRunner, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// `refs tag` against a ref recorded WITHOUT a `tag_format` — what `refs add` writes when detection
// finds no reliable format, rather than making the caller invent one. Split out of `tag.test.ts`
// only because that file is at its line limit; same fixture strategy (a real `file://` clone into
// the checkout path, config seeded directly via `seedConfig`) and the same generous timeout, since
// each case clones a real git repository in setup.
const TEST_TIMEOUT_MS = 30_000;
const REF_KEY = 'github.com/acme/untagged';
// Carries a verified override, so a monorepo can still resolve per-package versions even when the
// repository itself has no format worth recording.
const PACKAGE_NAME = 'pkg';
// Neither its own format nor a ref-level one to inherit — the case that used to be unreachable,
// because the ref level was mandatory.
const NO_FORMAT_PACKAGE_NAME = 'pkg-no-format';
const REF_ENTRY = {
  default_branch: 'main',
  description: 'Widget, recorded without a tag format',
  packages: {
    [NO_FORMAT_PACKAGE_NAME]: {
      description: 'Package without its own tag_format',
      path: 'packages/pkg-no-format',
    },
    [PACKAGE_NAME]: {
      description: 'Package with a verified tag_format',
      path: 'packages/pkg',
      tag_format: 'pkg@{version}',
    },
  },
  url: 'https://github.com/acme/untagged',
};
// The checkout does carry tags: the point is that the CONFIG says nothing about how to read them,
// so a `3` here can never be mistaken for "the repository has no tags".
const FIXTURE_TAGS = ['v1.0.0', 'pkg@2.0.0'];

const CLONE_SUCCESS_EXIT_CODE = 0;
const setupRunner = new SpawnRunner();

type TagEnvelope = {
  data?: { key: string; ref_path: string; tag: string; version: string };
  error?: { code: string; message: string };
  ok: boolean;
};

const parseSoleEnvelope = (stdout: readonly string[]): TagEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as TagEnvelope;
};

const cloneFixtureInto = async (fixtureDir: string, dest: string): Promise<void> => {
  const result = await setupRunner.run('git', ['clone', '-q', '--', fixtureDir, dest]);
  if (result.exitCode !== CLONE_SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git clone failed: ${result.stderr}`);
  }
};

type TagFixture = {
  ctx: CliContext;
  stdout: string[];
};

const setupUntaggedFixture = async (homeDir: string): Promise<TagFixture> => {
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

describe('refs tag: ref without a tag_format', () => {
  it(
    '(g) exits 3 (validation) rather than resolving against an invented format',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupUntaggedFixture(homeDir);

          await run(ctx, ['node', 'refs', 'tag', REF_KEY, '1.0.0', '--json']);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('validation');
          expect(envelope.error?.message).toMatch(/no tag_format configured/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs tag: package override without a ref-level format', () => {
  it(
    "(h) still resolves through the package's own tag_format",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupUntaggedFixture(homeDir);
          const argv = ['node', 'refs', 'tag', REF_KEY, '2.0.0', '--package'];

          await run(ctx, [...argv, PACKAGE_NAME, '--json']);

          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.ok).toBe(true);
          expect(envelope.data?.tag).toBe('pkg@2.0.0');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(i) exits 3 for a package with nothing of its own and nothing to inherit',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await setupUntaggedFixture(homeDir);
          const argv = ['node', 'refs', 'tag', REF_KEY, '1.0.0', '--package'];

          await run(ctx, [...argv, NO_FORMAT_PACKAGE_NAME, '--json']);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseSoleEnvelope(stdout);
          expect(envelope.error?.message).toMatch(/no tag_format configured/u);
          expect(envelope.error?.message).toMatch(new RegExp(NO_FORMAT_PACKAGE_NAME, 'u'));
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
