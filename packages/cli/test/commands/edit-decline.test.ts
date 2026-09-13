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

// `refs edit <ref> --package <name> --path <path> --decline` — recording that a package the
// checkout declares is deliberately not registered.
//
// Before it, an `unregistered` finding had no answer but "yes": the package returned in every
// report forever, so `config-drift` sat on WARN permanently and the next real finding arrived in
// a line already being ignored. Six of seven findings on a real home were decisions that had
// already been made.

const EDIT_REF = ['node', 'refs', 'edit', REF_KEY];
const TWO_DECISIONS = 2;

const declineArgs = (name: string, path: string, flag = '--decline'): string[] => [
  ...EDIT_REF,
  '--package',
  name,
  flag,
  '--path',
  path,
  '--json',
];

describe('refs edit --decline: recording the decision', () => {
  it('stores the name and the path together', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);

        await run(ctx, declineArgs('@acme/shim', 'packages/shim'));

        // Name alone would also silence a different package that later takes it; path alone would
        // silence whatever moves in.
        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]?.declined_packages).toStrictEqual([
          { name: '@acme/shim', path: 'packages/shim' },
        ]);
      }),
    );
  });

  it('keeps earlier decisions when a second one is recorded', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);
        await run(ctx, declineArgs('@acme/one', 'packages/one'));

        await run(ctx, declineArgs('@acme/two', 'packages/two'));

        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]?.declined_packages).toHaveLength(TWO_DECISIONS);
      }),
    );
  });
});

describe('refs edit --undecline: withdrawing one', () => {
  it('withdraws one with --undecline, leaving the rest', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);
        await run(ctx, declineArgs('@acme/one', 'packages/one'));
        await run(ctx, declineArgs('@acme/two', 'packages/two'));

        await run(ctx, declineArgs('@acme/one', 'packages/one', '--undecline'));

        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]?.declined_packages).toStrictEqual([
          { name: '@acme/two', path: 'packages/two' },
        ]);
      }),
    );
  });
});

describe('refs edit --decline: what it leaves behind', () => {
  it('drops the list entirely once the last decision is withdrawn', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);
        await run(ctx, declineArgs('@acme/one', 'packages/one'));

        await run(ctx, declineArgs('@acme/one', 'packages/one', '--undecline'));

        // An empty array is not the same as no key: TOML can write only the absent one, and
        // everywhere else a ref with no declines simply has no such field.
        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]).not.toHaveProperty('declined_packages');
      }),
    );
  });

  it('clears a matching decision when the package is registered after all', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);
        await run(ctx, declineArgs('@acme/later', 'packages/later'));

        await run(ctx, [
          ...EDIT_REF,
          '--package',
          '@acme/later',
          '--create',
          '--path',
          'packages/later',
          '--description',
          'Registered after all.',
          '--json',
        ]);

        // A decision left on record for a package the configuration now has is a trap for whoever
        // unregisters it later.
        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]).not.toHaveProperty('declined_packages');
      }),
    );
  });
});

describe('refs edit --decline: what it refuses', () => {
  it('refuses a package the ref already registers', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, declineArgs(PACKAGE_NAME, 'packages/pkg'));

        // The finding a decline suppresses does not exist for a registered package, so the record
        // would be a decision about nothing.
        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.message).toContain('unregister it first');
      }),
    );
  });

  it('refuses the same decision twice', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);
        await run(ctx, declineArgs('@acme/one', 'packages/one'));
        stdout.length = 0;

        await run(ctx, declineArgs('@acme/one', 'packages/one'));

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.error?.message).toContain('already declined');
      }),
    );
  });

  it('refuses to withdraw a decision nobody made', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, declineArgs('@acme/nope', 'packages/nope', '--undecline'));

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.error?.message).toContain('nothing to undo');
      }),
    );
  });
});

describe('refs edit --decline: shapes it will not guess at', () => {
  it('refuses --decline without --path', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [...EDIT_REF, '--package', '@acme/one', '--decline', '--json']);

        // A path guessed from a scan that may be incomplete is exactly the claim refs must not
        // make, so the caller supplies the observed one.
        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.error?.message).toContain('--path <path>');
      }),
    );
  });

  it('refuses two modes at once', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [...EDIT_REF, '--package', '@acme/one', '--decline', '--remove', '--json']);

        const envelope = parseSoleEnvelope(stdout);
        expect(envelope.error?.message).toContain('different answers');
      }),
    );
  });
});
