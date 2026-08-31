import { NEXT_KEY, seedNextFixture } from '../helpers/next-fixture.ts';
import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { minutesAgoIso, seedConfig, seedState } from '../helpers/ref-fixtures.ts';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

// `refs resolve`'s flags, at the CLI boundary. Between them they replace the three-call sequence
// the skill used to mandate — resolve, sync, resolve AGAIN — with one call, and close the gap where
// resolve reported a path without establishing that the path was this ref's checkout.

// Well past the default one-hour `sync_ttl`, so the ref reads as due for a fetch.
const STALE_MINUTES = 120;

type JsonEnvelope = {
  data: Record<string, unknown>;
  error?: { code: string; message: string };
  ok: boolean;
};

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

  it('reports a package the named ref does not register, instead of falling back to the ref', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['nosuch', '--ref', NEXT_KEY]);

        // Falling through to ref routing would hand back the ref with `package: null` — a success
        // envelope answering a question nobody asked. The caller named the ref; a query that
        // matches nothing in it is a mistake worth reporting.
        expect(envelope.error?.code).toBe('not_found');
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
          '[core]\n\thooksPath = /fixture/hooks\n[remote "origin"]\n\turl = https://github.com/acme/elsewhere\n',
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

describe('refs resolve --project: the installed version', () => {
  it('reports what the project has installed, not what the checkout contains', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const project = join(homeDir, 'a-project');
        await mkdir(join(project, 'node_modules', 'next'), { recursive: true });
        await writeFile(
          join(project, 'node_modules', 'next', 'package.json'),
          JSON.stringify({ name: 'next', version: '13.4.1' }),
        );

        const envelope = await resolveJson(homeDir, ['next', '--project', project]);

        expect(envelope.data['installed']).toMatchObject({ status: 'found', version: '13.4.1' });
      }),
    );
  });

  it('refuses a query that names a ref rather than a package', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, [NEXT_KEY, '--project', homeDir]);

        // Inferring the only package in a ref would make the command's meaning depend on
        // configuration the caller cannot see from the invocation.
        expect(envelope.error?.code).toBe('usage');
      }),
    );
  });
});

describe('refs resolve --sync-if-stale: refusing to sync what sync cannot repair', () => {
  it('refuses a checkout whose identity was never established', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });
        const home = resolveHome({ REFS_HOME: homeDir });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
        // Stale, so a sync is actually due — otherwise the flag is a no-op and the guard never runs.
        await seedState(home, { [NEXT_KEY]: { last_fetched_at: minutesAgoIso(STALE_MINUTES) } });
        await writeFile(join(dest, '.git', 'config'), '[remote "origin"]\n\turl = https://x/y\n');

        const envelope = await resolveJson(homeDir, ['next', '--sync-if-stale']);

        // `sync` hard-resets and cleans. Handing it a directory whose identity is unknown is how a
        // stray clone gets its history wiped, so this fails rather than proceeding or silently
        // skipping — the caller asked for freshness.
        expect(envelope.error?.code).toBe('validation');
        expect(envelope.error?.message).toContain('refusing to sync');
      }),
    );
  });
});
