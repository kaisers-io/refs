import { NEXT_ENTRY, NEXT_KEY, seedNextFixture } from '../helpers/next-fixture.ts';
import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// `refs resolve`'s flags, at the CLI boundary. Between them they replace the three-call sequence
// the skill used to mandate — resolve, sync, resolve AGAIN — with one call, and close the gap where
// resolve reported a path without establishing that the path was this ref's checkout.

type JsonEnvelope = {
  data: Record<string, unknown>;
  error?: { code: string; message: string; reason?: string };
  ok: boolean;
};

// Git stores a backslash in a config value as `\\`; a Windows hooks path is full of them.
const escapeGitValue = (value: string): string => value.replaceAll('\\', String.raw`\\`);

const soleEnvelope = (stdout: readonly string[]): JsonEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as JsonEnvelope;
};

const resolveJson = async (homeDir: string, args: readonly string[]): Promise<JsonEnvelope> => {
  const { ctx, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await run(ctx, ['node', 'refs', 'resolve', ...args, '--json']);
  return soleEnvelope(stdout);
};

describe('refs resolve --ref: scoping a package name to one ref', () => {
  it('resolves the package within the named ref', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['next', '--ref', NEXT_KEY]);

        expect(envelope.data['package']).toMatchObject({ name: 'next', status: 'verified' });
      }),
    );
  });

  it('resolves an import path within the named ref, longest prefix first', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['next/navigation', '--ref', NEXT_KEY]);

        // Scoping to a ref does not change what an import path means — `--ref` narrows where to
        // look, not how to read the query.
        expect(envelope.data['package']).toMatchObject({ name: 'next' });
      }),
    );
  });
});

describe('refs resolve --ref: a package the named ref does not register', () => {
  it('reports the miss instead of falling back to the ref itself', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['nosuch', '--ref', NEXT_KEY]);

        // Falling through to ref routing would hand back the ref with `package: null` — a success
        // envelope answering a question nobody asked. The caller named the ref; a query that
        // matches nothing in it is a mistake worth reporting.
        expect(envelope.error).toMatchObject({
          code: 'not_found',
          // The ref WAS identified; only the package lookup inside it failed. Reporting
          // `unmatched_query` here would say every route was searched when only this ref's package
          // map was.
          reason: 'package_not_registered',
        });
      }),
    );
  });
});

describe('refs resolve --ref: an unconfigured ref', () => {
  it('reports it as an absent ref, not as an unmatched query', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['next', '--ref', 'nosuch-ref-anywhere']);

        // `--ref` names one ref and nothing else is tried, so a miss establishes that this ref is
        // not configured — a stronger and actionable fact, and the one miss where suggesting
        // `refs add` is sound.
        expect(envelope.error).toMatchObject({
          code: 'not_found',
          reason: 'ref_not_registered',
        });
      }),
    );
  });
});

describe('refs resolve --ref: the remedy the ambiguity error names', () => {
  it('points at --ref rather than at the full ref key', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const home = resolveHome({ REFS_HOME: homeDir });
        const shared = { description: 'shared name', path: 'packages/util' };
        await seedConfig(home, {
          'github.com/acme/one': {
            default_branch: 'main',
            description: 'one',
            packages: { util: shared },
            url: 'https://github.com/acme/one',
          },
          'github.com/acme/two': {
            default_branch: 'main',
            description: 'two',
            packages: { util: shared },
            url: 'https://github.com/acme/two',
          },
        });

        const envelope = await resolveJson(homeDir, ['util']);

        // The old message said "use the full ref key", which routes by ref and comes back with
        // `package: null` — advice the command could not honour.
        expect(envelope.error?.message).toContain('--ref');
      }),
    );
  });
});

describe('refs resolve: checkout identity', () => {
  it('reports a present checkout that is not this ref as unmanaged, and does not verify inside it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const home = resolveHome({ REFS_HOME: homeDir });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
        // A plausible checkout with no refs marker: what a manual `git clone` at this path looks
        // like. Its contents may even satisfy verification — for a repository that is not this ref.
        await writeFile(
          join(dest, '.git', 'config'),
          '[remote "origin"]\n\turl = https://github.com/vercel/next.js\n',
        );

        const envelope = await resolveJson(homeDir, ['next']);

        expect(envelope.data['checkout']).toStrictEqual({
          reason: 'no_refs_marker',
          status: 'unmanaged',
        });
        // Verification is gated on identity: a manifest read inside an unrelated checkout can
        // answer `verified` about entirely the wrong repository.
        expect(envelope.data['package']).toMatchObject({ status: 'unverifiable' });
      }),
    );
  });
});

describe('refs resolve: checkout identity, wrong repository', () => {
  it('reports a checkout whose origin is a different repository', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const home = resolveHome({ REFS_HOME: homeDir });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
        await writeFile(
          join(dest, '.git', 'config'),
          `[core]\n\thooksPath = ${escapeGitValue(home.hooksDir)}\n[remote "origin"]\n\turl = https://github.com/acme/elsewhere\n`,
        );

        const envelope = await resolveJson(homeDir, ['next']);

        // The url is never echoed back: it can carry credentials.
        expect(envelope.data['checkout']).toStrictEqual({
          reason: 'origin_mismatch',
          status: 'unmanaged',
        });
      }),
    );
  });
});

describe('refs resolve: checkout identity, unusable .git', () => {
  it('reports an occupied path with no .git as unmanaged, not as missing', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const home = resolveHome({ REFS_HOME: homeDir });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
        // The directory is there, with the configured package manifest in it, but nothing makes it
        // a git checkout — let alone this ref's. Calling that `missing` would let verification run
        // against whatever it happens to contain and report `verified` about an unrelated tree.
        await rm(join(dest, '.git'), { force: true, recursive: true });

        const envelope = await resolveJson(homeDir, ['next']);

        expect(envelope.data['checkout']).toStrictEqual({ reason: 'no_git', status: 'unmanaged' });
        expect(envelope.data['package']).toMatchObject({ status: 'unverifiable' });
      }),
    );
  });

  it('reports a .git file — a worktree or submodule — rather than following it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const home = resolveHome({ REFS_HOME: homeDir });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
        await rm(join(dest, '.git'), { force: true, recursive: true });
        await writeFile(join(dest, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');

        const envelope = await resolveJson(homeDir, ['next']);

        expect(envelope.data['checkout']).toStrictEqual({
          reason: 'git_is_file',
          status: 'unmanaged',
        });
      }),
    );
  });
});

describe("refs resolve: a checkout whose hooks marker is somebody else's", () => {
  it('does not accept an arbitrary core.hooksPath as the refs marker', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const home = resolveHome({ REFS_HOME: homeDir });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
        // A manual clone of the right repository that sets `core.hooksPath` for its own purposes —
        // Husky, say. Merely HAVING the setting is not the marker; it has to be this home's hooks
        // directory, which is what `add` compares against before it will reuse a checkout.
        await writeFile(
          join(dest, '.git', 'config'),
          `[core]\n\thooksPath = .husky\n[remote "origin"]\n\turl = ${NEXT_ENTRY.url}\n`,
        );

        const envelope = await resolveJson(homeDir, ['next']);

        expect(envelope.data['checkout']).toStrictEqual({
          reason: 'no_refs_marker',
          status: 'unmanaged',
        });
      }),
    );
  });

  it('refuses a config git itself would reject', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const home = resolveHome({ REFS_HOME: homeDir });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
        // An unterminated quote. Skipping the bad line and keeping the rest would let a corrupt
        // config still produce the marker and origin, and so still read as managed.
        await writeFile(
          join(dest, '.git', 'config'),
          `[core]\n\thooksPath = "${escapeGitValue(home.hooksDir)}\n[remote "origin"]\n\turl = ${NEXT_ENTRY.url}\n`,
        );

        const envelope = await resolveJson(homeDir, ['next']);

        expect(envelope.data['checkout']).toStrictEqual({
          reason: 'config_malformed',
          status: 'unverifiable',
        });
      }),
    );
  });
});
