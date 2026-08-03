import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { RefsHome } from '@kaisers-io/refs-core';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// The two `--json` payload opt-ins of `refs show` — `--packages` (the full package map, replaced by
// a `packages_count` by default) and `--tags` (the `git tag` probe, skipped entirely by default) —
// split into their own file (rather than piled onto `show.test.ts`) purely to keep both under the
// repo's 300-line oxlint cap, the same reason `resolve-routing.test.ts` exists.

const PKG_KEY = 'github.com/acme/mono';
const MONO_PACKAGE_COUNT = 2;
const HUMAN_TAGS = ['v3.1.0', 'v3.0.0'];
const NO_CALLS = 0;
const ONE_CALL = 1;
const ONE_LINE = 1;

const MONO_ENTRY = {
  default_branch: 'main',
  description: 'Mono repo',
  packages: {
    'pkg-a': { description: 'first', path: 'packages/a' },
    'pkg-b': { description: 'second', path: 'packages/b' },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/mono',
};

const parseSoleEnvelope = (stdout: readonly string[]): { data: unknown; ok: boolean } => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as { data: unknown; ok: boolean };
};

/** Seeds the monorepo fixture (two packages) with a present checkout — shared by the tag-probe
 * tests below, split out purely to keep each of them under the repo's `max-statements` cap. */
const seedMonoWithCheckout = async (home: RefsHome): Promise<void> => {
  await seedConfig(home, { [PKG_KEY]: MONO_ENTRY });
  await markCheckoutPresent(checkoutPath(home, zRefKey.parse(PKG_KEY)));
};

describe('refs show: package payload is opt-in in json mode', () => {
  it('emits packages_count and no packages map by default', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [PKG_KEY]: MONO_ENTRY });

        await run(ctx, ['node', 'refs', 'show', 'mono', '--json']);

        const envelope = parseSoleEnvelope(stdout) as {
          data: Record<string, unknown>;
          ok: boolean;
        };
        expect(envelope.ok).toBe(true);
        expect(envelope.data['packages_count']).toBe(MONO_PACKAGE_COUNT);
        expect(envelope.data).not.toHaveProperty('packages');
        expect(envelope.data).not.toHaveProperty('sample_tags');
      }),
    );
  });
});

describe('refs show: --packages', () => {
  it('emits the full packages map alongside the count', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [PKG_KEY]: MONO_ENTRY });

        await run(ctx, ['node', 'refs', 'show', 'mono', '--json', '--packages']);

        const envelope = parseSoleEnvelope(stdout) as { data: Record<string, unknown> };
        expect(envelope.data['packages']).toStrictEqual({
          'pkg-a': { description: 'first', path: 'packages/a' },
          'pkg-b': { description: 'second', path: 'packages/b' },
        });
        expect(envelope.data['packages_count']).toBe(MONO_PACKAGE_COUNT);
      }),
    );
  });
});

describe('refs show: tag probe is opt-in in json mode', () => {
  it('runs no git tag subprocess without --tags', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedMonoWithCheckout(home);

        await run(ctx, ['node', 'refs', 'show', 'mono', '--json']);

        expect(runner.calls).toHaveLength(NO_CALLS);
        expect(stdout).toHaveLength(ONE_LINE);
      }),
    );
  });
});

// Human output has no opt-in: it must keep printing its `tags:` line, so the probe has to run even
// with no flags at all. Guards the `!opts.json` disjunct of `show.ts`'s `tags:` option — dropping it
// leaves every `--json` test green while human output silently loses the line.
describe('refs show: human mode always probes for tags', () => {
  it('prints the tags line with no flags at all', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedMonoWithCheckout(home);
        runner.expect('git tag', { stdout: `${HUMAN_TAGS.join('\n')}\n` });

        await run(ctx, ['node', 'refs', 'show', 'mono']);

        expect(stdout).toContain(`tags: ${HUMAN_TAGS.join(', ')}`);
        expect(runner.calls).toHaveLength(ONE_CALL);
      }),
    );
  });
});

describe('refs show: --tags', () => {
  it('runs the probe and emits sample_tags', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedMonoWithCheckout(home);
        runner.expect('git tag', { stdout: 'v2.0.0\nv1.0.0\n' });

        await run(ctx, ['node', 'refs', 'show', 'mono', '--json', '--tags']);

        expect(runner.calls).toHaveLength(ONE_CALL);
        const envelope = parseSoleEnvelope(stdout) as { data: { sample_tags: string[] } };
        expect(envelope.data.sample_tags).toStrictEqual(['v2.0.0', 'v1.0.0']);
      }),
    );
  });
});
