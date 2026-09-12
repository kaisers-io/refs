import {
  PACKAGE_NAME,
  REF_KEY,
  UNKNOWN_PACKAGE_NAME,
  parseSoleEnvelope,
  setupEditFixture,
} from '../helpers/edit-support.ts';
import { describe, expect, it } from 'vitest';
import { readConfig, resolveHome } from '@kaisers-io/refs-core';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { run } from '../../src/main.ts';

// `refs edit <ref> --package <name> --remove` — the repair for the drift probe's `missing`
// finding, and the counterpart to `--create`.
//
// It exists for the same reason `--create` does: the finding had no runnable repair. A package
// that left the repository's workspaces leaves an entry behind that `refs resolve` still answers
// with, pointing at a path no checkout has. The only instruction refs could give was "hand-edit
// config.toml".
//
// It touches CONFIGURATION only, and never consults a checkout. A removal must work while the
// checkout is stale, absent, or still carrying the directory: the entry is the thing being
// removed, not the code.

const EDIT_REF = ['node', 'refs', 'edit', REF_KEY];

const removeArgs = (name: string): string[] => [
  ...EDIT_REF,
  '--package',
  name,
  '--remove',
  '--json',
];

describe('refs edit --remove: unregistering a package', () => {
  it('removes the named entry', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);

        await run(ctx, removeArgs(PACKAGE_NAME));

        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]?.packages?.[PACKAGE_NAME]).toBeUndefined();
      }),
    );
  });

  it('leaves every sibling entry standing', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);
        await run(ctx, [
          ...EDIT_REF,
          '--package',
          '@acme/keep',
          '--create',
          '--path',
          'packages/keep',
          '--description',
          'The surviving package.',
          '--json',
        ]);

        await run(ctx, removeArgs(PACKAGE_NAME));

        // A removal that took the whole table with it would leave `resolve` answering `not_found`
        // for source that is present — the exact failure the finding asked to repair.
        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]?.packages).toStrictEqual({
          '@acme/keep': { description: 'The surviving package.', path: 'packages/keep' },
        });
      }),
    );
  });
});

describe('refs edit --remove: what it leaves behind', () => {
  it('drops the packages table once the last entry goes', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);

        await run(ctx, removeArgs(PACKAGE_NAME));

        // An empty table is not the same as no table: `add` and the drift probe both read the
        // field's ABSENCE as "this ref registers no packages".
        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]).not.toHaveProperty('packages');
      }),
    );
  });
});

describe('refs edit --remove: what it reports', () => {
  it('reports what it removed, path included', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, removeArgs(PACKAGE_NAME));

        // The path is the only record of WHICH entry went; nothing else in the config holds it
        // afterwards.
        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.data?.old).toStrictEqual({
          description: 'Widget package',
          name: PACKAGE_NAME,
          path: 'packages/pkg',
        });
      }),
    );
  });
});

describe('refs edit --remove: what it refuses', () => {
  it('refuses a package the ref never registered', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, removeArgs(UNKNOWN_PACKAGE_NAME));

        // Silence here would tell an agent a typo'd name had been cleaned up.
        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.message).toContain('nothing to remove');
      }),
    );
  });

  it('refuses --create and --remove in the same invocation', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [...EDIT_REF, '--package', PACKAGE_NAME, '--create', '--remove', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.message).toContain('not both');
      }),
    );
  });

  it('refuses --remove without --package', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [...EDIT_REF, '--remove', '--json']);

        // Without a name there is nothing to remove but the ref itself, which is `refs remove`'s
        // job — silently widening the scope would delete a checkout nobody asked about.
        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.message).toContain('--package');
      }),
    );
  });
});
