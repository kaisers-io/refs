import { EXIT, checkoutPath, resolveHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectFinalizedState,
  expectNoPackagesTable,
  expectPackagesWithDescriptions,
  expectPendingProposal,
  finalizeViaProposalFile,
  finalizeViaStdinProposal,
  initHome,
  parseLastEnvelope,
  realContextFor,
  runAddDryRunJson,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { access } from 'node:fs/promises';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { resolveAddSource } from '../../src/commands/add-source.ts';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { zProposal } from '@kaisers-io/refs-core';

// Integration suite for `refs add`'s two-phase flow, against real `file://` git fixtures (never
// FakeRunner — `add` shells out to real `git clone`/`git tag`/`git rev-parse` etc.). Test case
// labels (a)-(e) mirror the task brief's Step 1 list. Shared scaffolding + `expect*` assertion
// helpers live in `test/helpers/add-support.ts`, split out purely to keep both files under the
// repo's 300-line oxlint cap and each individual test under its max-statements cap.

const TEST_TIMEOUT_MS = 30_000;
const TWO_PACKAGES = 2;
const HTTP_STATUS_OK = 200;

type FinalizeEnvelope = {
  data: { entry: { description: string; packages?: unknown }; key: string };
  ok: boolean;
};

type ErrorEnvelope = {
  error?: { code: string; message: string };
  ok: boolean;
};

// Fills in the top-level `description` and every package's description (falling back to a
// placeholder for `@fixture/b`, which the fixture deliberately ships without one) — the human
// review step the real two-phase workflow expects between `--dry-run` and `--proposal`. A plain
// top-level function (not inline in a test body) so its `??` fallback never runs afoul of
// `vitest/no-conditional-in-test`.
type ProposalPackageEntry = ReturnType<typeof zProposal.parse>['packages'][string];

const withDescription = (
  name: string,
  pkg: ProposalPackageEntry,
): ProposalPackageEntry & { description: string } => {
  if (pkg.description === undefined) {
    return { ...pkg, description: `${name} package` };
  }
  return { ...pkg, description: pkg.description };
};

const completeProposal = (proposal: ReturnType<typeof zProposal.parse>): unknown => ({
  ...proposal,
  description: 'A fixture monorepo.',
  packages: Object.fromEntries(
    Object.entries(proposal.packages).map(([name, pkg]) => [name, withDescription(name, pkg)]),
  ),
});

describe('refs add --dry-run', () => {
  it(
    '(a) detects two workspace packages and a v{version} tag format on a monorepo fixture',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ monorepo: true, tags: ['v1.0.0'] });

          const proposal = await runAddDryRunJson(ctx, stdout, fixture.url);

          expect(proposal.tag_format_candidate).toBe('v{version}');
          expect(Object.keys(proposal.packages)).toHaveLength(TWO_PACKAGES);
          const home = resolveHome(ctx.env);
          await expectPendingProposal(home, proposal.key);
          await expect(access(checkoutPath(home, proposal.key))).resolves.toBeUndefined();
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --proposal', () => {
  it(
    '(b) finalizes a completed proposal into config with both package descriptions filled in',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ monorepo: true, tags: ['v1.0.0'] });
          const proposal = await runAddDryRunJson(ctx, stdout, fixture.url);

          await finalizeViaProposalFile(ctx, homeDir, completeProposal(proposal));

          const home = resolveHome(ctx.env);
          await expectPackagesWithDescriptions(home, proposal.key, TWO_PACKAGES);
          await expectFinalizedState(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(b2) finalizes a completed proposal read from stdin (`--proposal -`)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ tags: ['v1.0.0'] });
          const proposal = await runAddDryRunJson(ctx, stdout, fixture.url);

          await finalizeViaStdinProposal(ctx, completeProposal(proposal));

          const home = resolveHome(ctx.env);
          await expectFinalizedState(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: conflict on an already-configured ref', () => {
  it(
    '(c) adding the same source again conflicts (exit 5)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ tags: ['v1.0.0'] });
          await run(ctx, [
            'node',
            'refs',
            'add',
            fixture.url,
            '--description',
            'A fixture repo.',
            '--json',
          ]);

          await run(ctx, ['node', 'refs', 'add', fixture.url, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('conflict');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --description', () => {
  it(
    '(d) one-shot on a plain (non-monorepo) fixture yields no packages table',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ tags: ['v1.0.0'] });

          await run(ctx, [
            'node',
            'refs',
            'add',
            fixture.url,
            '--description',
            'A plain reference repo.',
            '--json',
          ]);

          const envelope = parseLastEnvelope(stdout) as FinalizeEnvelope;
          expect(envelope.ok).toBe(true);
          expect(envelope.data.entry.packages).toBeUndefined();
          expect(envelope.data.entry.description).toBe('A plain reference repo.');
          await expectNoPackagesTable(resolveHome(ctx.env), envelope.data.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

// `resolveNpmPackage`'s own canonicalization call never passes `allowFileUrls` (see
// `npm-resolver.ts#canonicalizeRepository`), so a packument whose `repository.url` is a `file://`
// fixture path always throws the registry's own "no usable repository field" fallback error —
// there is no way to make an `npm:<pkg>` source resolve to a local fixture end-to-end. This case is
// therefore exercised as a pure unit test of `resolveAddSource`'s npm branch instead: a fake fetcher
// stands in for the registry, and the assertion is that the resulting `{cloneUrl, key}` matches
// exactly what `canonicalizeGitUrl` derives from the packument's `repository.url` — the same seam
// `runDryRunCore` calls next. The clone/detect integration itself is covered by (a)-(d) above via
// direct `file://` urls.
describe('npm: source resolution (unit — file:// packument urls cannot be integration-tested)', () => {
  it('(e) resolves npm:<pkg> through the registry fetcher and canonicalizes its repository url', async () => {
    expect.hasAssertions();
    const { ctx } = testContext();
    ctx.fetcher = () =>
      Promise.resolve({
        json: () =>
          Promise.resolve({ repository: { url: 'git+https://github.com/example/demo.git' } }),
        status: HTTP_STATUS_OK,
      });

    const resolved = await resolveAddSource(ctx, 'npm:demo');

    expect(resolved).toStrictEqual({
      cloneUrl: 'https://github.com/example/demo.git',
      key: 'github.com/example/demo',
      npmPkgName: 'demo',
    });
  });
});

describe('refs add: usage errors', () => {
  it('--dry-run together with --proposal is a usage error', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout } = testContext();
      await run(ctx, [
        'node',
        'refs',
        'add',
        'https://example.com/owner/repo',
        '--dry-run',
        '--proposal',
        'x.json',
        '--json',
      ]);
      expect(process.exitCode).toBe(EXIT.USAGE);
      const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.message).toMatch(
        /only one of --dry-run, --proposal, or --description/u,
      );
    });
  });

  it('neither --dry-run, --proposal, nor --description is a usage error with the exact message', async () => {
    expect.hasAssertions();
    await withResetExitCode(async () => {
      const { ctx, stdout } = testContext();
      await run(ctx, ['node', 'refs', 'add', 'https://example.com/owner/repo', '--json']);
      expect(process.exitCode).toBe(EXIT.USAGE);
      const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
      expect(envelope.error?.message).toBe(
        'refs add needs --dry-run, --proposal, or --description',
      );
    });
  });
});
