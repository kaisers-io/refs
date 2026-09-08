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

// `refs edit <ref> --package <name> --create --path <p> --description <d>` — the only writer
// besides `add` that puts a package on a ref.
//
// It exists because the drift probe's `unregistered` finding had no repair: `refs add` refuses an
// already-tracked ref, and every other `refs edit` mode needs an entry to edit. The instruction
// that finding could give was "hand-edit config.toml", which is not something an agent should be
// told to do — and not something a user should have to do after their agent found the problem.
//
// It is deliberately a separate MODE rather than an upsert on the field edits. A misspelled
// `--package` name in an ordinary edit must keep failing with `not_found`: turning that into a
// silent registration is how a typo becomes a permanent wrong entry.

const EDIT_REF = ['node', 'refs', 'edit', REF_KEY];

const createArgs = (name: string, path: string, description: string): string[] => [
  ...EDIT_REF,
  '--package',
  name,
  '--create',
  '--path',
  path,
  '--description',
  description,
  '--json',
];

describe('refs edit --create: registering a package', () => {
  it('registers a package the ref did not have', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);

        await run(ctx, createArgs('@acme/new', 'packages/new', 'The new package.'));

        const config = await readConfig(resolveHome(ctx.env));
        expect(config.refs[REF_KEY]?.packages?.['@acme/new']).toStrictEqual({
          description: 'The new package.',
          path: 'packages/new',
        });
      }),
    );
  });

  it('leaves the packages the ref already had untouched', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = await setupEditFixture(homeDir);

        await run(ctx, createArgs('@acme/new', 'packages/new', 'The new package.'));

        const config = await readConfig(resolveHome(ctx.env));
        // A registration is an addition, never a rewrite: a hand-written description or a
        // tag_format on a sibling entry must survive it.
        expect(config.refs[REF_KEY]?.packages?.[PACKAGE_NAME]).toStrictEqual({
          description: 'Widget package',
          path: 'packages/pkg',
        });
      }),
    );
  });
});

describe('refs edit --create: what it refuses', () => {
  it('refuses a package that is already registered', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, createArgs(PACKAGE_NAME, 'packages/elsewhere', 'Different.'));

        expect(parseSoleEnvelope(stdout).error?.message).toContain('already registered');
        const config = await readConfig(resolveHome(ctx.env));
        // Not a silent overwrite: the existing path stands.
        expect(config.refs[REF_KEY]?.packages?.[PACKAGE_NAME]?.path).toBe('packages/pkg');
      }),
    );
  });

  it('rejects a prototype-shaped package name', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, createArgs('__proto__', 'packages/x', 'Nope.'));

        // An object literal's computed key creates a real own property even for `__proto__`, so
        // it reaches the config rather than silently vanishing into the prototype — and the
        // record schema wrapping the packages table is what rejects it. Two layers catch this
        // (`createPackageEntry`'s own validation and `writeConfig`'s); the test pins the
        // behaviour, not which layer produced it.
        expect(parseSoleEnvelope(stdout).error?.message).toContain('package key must be');
      }),
    );
  });
});

describe('refs edit --create: values the schema rejects', () => {
  it('rejects a path that escapes the checkout', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, createArgs('@acme/new', '../elsewhere', 'Outside.'));

        expect(parseSoleEnvelope(stdout).error?.message).toContain('package path must be');
      }),
    );
  });

  it('rejects an empty description rather than inventing one', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, createArgs('@acme/new', 'packages/new', ''));

        expect(parseSoleEnvelope(stdout).error?.code).toBe('validation');
      }),
    );
  });
});

describe('refs edit --create: the boundary with an ordinary field edit', () => {
  it('still fails with not_found when an ordinary edit names an unregistered package', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [
          ...EDIT_REF,
          'path',
          'packages/typo',
          '--package',
          '@acme/mispelled',
          '--json',
        ]);

        // The single most important thing `--create` must NOT do: a typo in `--package` stays an
        // error, never a quiet registration at whatever path the caller happened to type.
        expect(parseSoleEnvelope(stdout).error?.code).toBe('not_found');
      }),
    );
  });

  it('refuses --create alongside a positional field and value', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [
          ...EDIT_REF,
          'path',
          'packages/new',
          '--package',
          '@acme/new',
          '--create',
          '--path',
          'packages/new',
          '--description',
          'Both forms at once.',
          '--json',
        ]);

        // Two mutually exclusive forms in one invocation. Guessing which was meant is how a field
        // edit turns into a registration.
        expect(parseSoleEnvelope(stdout).error?.code).toBe('usage');
      }),
    );
  });
});

describe('refs edit --create: incomplete invocations', () => {
  it('refuses --path and --description without --create', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [
          ...EDIT_REF,
          'path',
          'packages/moved',
          '--package',
          PACKAGE_NAME,
          '--description',
          'Silently ignored?',
          '--json',
        ]);

        // Accepting this would silently drop the description: the field edit only ever writes the
        // one field its positionals name.
        expect(parseSoleEnvelope(stdout).error?.code).toBe('usage');
      }),
    );
  });
});

describe('refs edit --create: a create missing its own fields', () => {
  it('refuses --create without a --package name', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        await run(ctx, [
          ...EDIT_REF,
          '--create',
          '--path',
          'packages/new',
          '--description',
          'No name.',
          '--json',
        ]);

        expect(parseSoleEnvelope(stdout).error?.code).toBe('usage');
      }),
    );
  });

  it('still requires <field> <value> for an ordinary edit', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = await setupEditFixture(homeDir);

        // Commander enforced this while the positionals were `<field> <value>`; they are optional
        // now so `--create` can carry its fields as flags, which moves the check into the code.
        await run(ctx, [...EDIT_REF, 'path', '--json']);

        expect(parseSoleEnvelope(stdout).error?.code).toBe('usage');
      }),
    );
  });
});
