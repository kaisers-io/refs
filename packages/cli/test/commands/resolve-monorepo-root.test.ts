import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { addRefViaDescription } from '../helpers/sync-support.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';

// The case reported in #88, end to end against a real `file://` monorepo remote.
//
// A workspace root is not one of its own glob targets, so a root that names itself was registered
// nowhere: `refs resolve <root-name>` came back `not_found`, and the skill read that as "the
// repository is not tracked" and said so. The fixture's root is `fixture-root` — private, named,
// and absent from `packages/*` — which is exactly that shape.

type ResolveData = {
  key: string;
  package: { name: string; path: string | null; status: string } | null;
};

/** Resolves through the SAME real context that cloned the fixture. `REFS_ALLOW_FILE_URLS=1` only
 * lives there, and without it the stored `file://` url fails checkout-identity verification — the
 * package would come back `unverifiable` for a reason that has nothing to do with what is tested. */
const resolveWithin = async (
  ctx: CliContext,
  stdout: string[],
  query: string,
): Promise<ResolveData> => {
  await run(ctx, ['node', 'refs', 'resolve', query, '--json']);
  return (parseLastEnvelope(stdout) as { data: ResolveData }).data;
};

describe('refs resolve: a monorepo by the name its own root declares', () => {
  it(
    'resolves to the ref, with the root package at "."',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({
            monorepo: true,
            monorepoAllDescribed: true,
          });
          const added = await addRefViaDescription(ctx, stdout, fixture.url);

          const data = await resolveWithin(ctx, stdout, 'fixture-root');

          expect(data.key).toBe(added.key);
          expect(data.package).toMatchObject({
            name: 'fixture-root',
            path: '.',
            // Verified rather than assumed: the manifest at `.` really does declare this name.
            status: 'verified',
          });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs resolve: the workspace members alongside the root', () => {
  it(
    'still resolves them exactly as before',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({
            monorepo: true,
            monorepoAllDescribed: true,
          });
          await addRefViaDescription(ctx, stdout, fixture.url);

          const data = await resolveWithin(ctx, stdout, '@fixture/a');

          expect(data.package).toMatchObject({ path: 'packages/a' });
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
