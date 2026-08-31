import { NEXT_KEY, seedNextFixture } from '../helpers/next-fixture.ts';
import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { minutesAgoIso, seedState } from '../helpers/ref-fixtures.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';

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

// `refs resolve --project` and `--sync-if-stale` at the CLI boundary. Split from
// `resolve-flags.test.ts` to keep both under the repo's 300-line cap; the routing and
// checkout-identity cases live there.
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
