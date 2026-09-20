import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';

// Which tag format a dry-run proposes, against a real `file://` repository with real tags and real
// manifests — the two shapes where counting gave an answer no release of the package carries.
//
// Both fixtures are modelled on measured upstream repositories. The monorepo is `Effect-TS/effect`
// and `withastro/astro`, where one package has tagged far more often than the rest and counting
// handed its prefix to all of them. The single-package one is `kysely-org/kysely`, whose older
// releases are bare and whose current ones are not, so the majority shape resolves nothing a
// user would ask for.

type Proposal = {
  packages: Record<string, { tag_format?: string }>;
  tag_format_candidate: string | null;
};

const dryRun = async (homeDir: string, fixtureUrl: string): Promise<Proposal> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  await run(ctx, ['node', 'refs', 'add', fixtureUrl, '--dry-run', '--json']);
  return (parseLastEnvelope(stdout) as { data: Proposal }).data;
};

describe('refs add --dry-run: a monorepo where one package has tagged far more often', () => {
  it(
    'gives the other package the format its own releases use',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // Both members are at 1.0.0. `@fixture/b` has tagged three times, `@fixture/a` once, so
          // counting names `@fixture/b@{version}` — and it is wrong for `@fixture/a` at every
          // version, including the one release both of them made.
          const fixture = await createFixtureRepo({
            monorepo: true,
            monorepoAllDescribed: true,
            tags: ['@fixture/b@1.0.0', '@fixture/b@0.9.0', '@fixture/b@0.8.0', '@fixture/a@1.0.0'],
          });

          const proposal = await dryRun(homeDir, fixture.url);

          expect(proposal.tag_format_candidate).toBe('@fixture/b@{version}');
          expect(proposal.packages['@fixture/a']?.tag_format).toBe('@fixture/a@{version}');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'leaves the package the count already named without an override of its own',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const fixture = await createFixtureRepo({
            monorepo: true,
            monorepoAllDescribed: true,
            tags: ['@fixture/b@1.0.0', '@fixture/b@0.9.0', '@fixture/b@0.8.0', '@fixture/a@1.0.0'],
          });

          const proposal = await dryRun(homeDir, fixture.url);

          // `refs tag` reads `package.tag_format ?? ref.tag_format`, so restating the ref's own
          // format on an entry would add a line that changes nothing.
          expect(proposal.packages['@fixture/b']?.tag_format).toBeUndefined();
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --dry-run: a member whose version matches a repository-wide tag', () => {
  it(
    'gets no override from a tag that does not name it',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // Measured on `vercel/next.js`, which carries a bare `1.0.0` tag from 2016 while a
          // private benchmark package inside it declares version 1.0.0. The tag exists and carries
          // the version; it is still not that package's release, and saying so on its entry would
          // make `refs tag` answer a question nobody could check.
          const fixture = await createFixtureRepo({
            monorepo: true,
            monorepoAllDescribed: true,
            tags: ['@fixture/b@2.0.0', '@fixture/b@2.1.0', '1.0.0'],
          });

          const proposal = await dryRun(homeDir, fixture.url);

          expect(proposal.packages['@fixture/a']?.tag_format).toBeUndefined();
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --dry-run: a repository whose older releases tag differently', () => {
  it(
    "proposes the format its current release uses, not the majority's",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // `fixture-solo` is the repository root at 1.0.0. Three bare tags outvote the one that
          // matches the version this repository is actually at.
          const fixture = await createFixtureRepo({
            rootOnlyWorkspace: true,
            tags: ['v1.0.0', '0.9.0', '0.8.0', '0.7.0'],
          });

          const proposal = await dryRun(homeDir, fixture.url);

          expect(proposal.tag_format_candidate).toBe('v{version}');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --dry-run: a repository with no version to anchor on', () => {
  it(
    'keeps the counted answer',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // No manifest at all — the shape every non-Node repository has. Counting is all there is,
          // and it is what `gin`, `serde`, `requests` and `tokio` were already answered by.
          const fixture = await createFixtureRepo({ tags: ['v2.0.0', 'v1.9.0'] });

          const proposal = await dryRun(homeDir, fixture.url);

          expect(proposal.tag_format_candidate).toBe('v{version}');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
