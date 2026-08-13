import { EXIT, readConfig, resolveHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  finalizeViaProposalFile,
  initHome,
  realContextFor,
  runAddDryRunJson,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';

// The reported failure, end to end, against a fixture repository that carries no tags at all.
// `refs add --dry-run` reports `tag_format_candidate: null`; finalize used to reject that, leaving
// whoever ran the add two options — invent a convention, or abandon the add. An agent picked the
// first, recommended `v{version}` for repositories it had just correctly described as untagged, and
// the user was asked to approve it. Everything below asserts the path that replaces it: null
// survives finalize as an absent field, and `refs tag` says so rather than resolving against a
// guess. Real git in setup (`file://` clone, like `add.test.ts`), hence the generous timeout.
const TEST_TIMEOUT_MS = 30_000;

/** Clones a tagless fixture, dry-runs it, and finalizes the proposal with only its description
 * filled in — deliberately leaving `tag_format_candidate` exactly as detection left it. */
const addUntaggedFixture = async (
  ctx: ReturnType<typeof realContextFor>['ctx'],
  stdout: string[],
  homeDir: string,
): Promise<string> => {
  await initHome(ctx);
  const fixture = await createFixtureRepo({});
  const proposal = await runAddDryRunJson(ctx, stdout, fixture.url);
  expect(proposal.tag_format_candidate).toBeNull();
  await finalizeViaProposalFile(ctx, homeDir, {
    ...proposal,
    description: 'A fixture repo that never tags.',
  });
  return proposal.key;
};

describe('refs add: a source with no tags', () => {
  it(
    'proposes a null tag format, finalizes without one, and refuses to resolve versions',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);

          const key = await addUntaggedFixture(ctx, stdout, homeDir);

          const config = await readConfig(resolveHome(ctx.env));
          expect(config.refs[key]).toBeDefined();
          expect(config.refs[key]).not.toHaveProperty('tag_format');

          await run(ctx, ['node', 'refs', 'tag', key, '1.0.0', '--json']);
          expect(process.exitCode).toBe(EXIT.VALIDATION);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
