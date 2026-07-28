import { EXIT, resolveHome } from '@kaisers-io/refs-core';
import {
  createManualCheckout,
  expectRefNotConfigured,
  setCheckoutOrigin,
  setupDryRunFixture,
  setupSourceFixture,
} from '../helpers/add-guards-support.ts';
import { describe, expect, it } from 'vitest';
import {
  finalizeViaProposalFile,
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { resolveAddSource } from '../../src/commands/add-helpers.ts';
import { rm } from 'node:fs/promises';
import { run } from '../../src/main.ts';

// Round-2 review regressions for `refs add`'s finalize/reuse path: finding 1 (atomic finalize must
// validate `head_sha`'s shape BEFORE any write, not just before `writeState`'s own — later —
// validation), finding 2 (checkout reuse must verify the refs-managed marker, not just origin),
// and finding 3 (checkout-identity comparison must tolerate cosmetic url variance). Kept out of
// `add-guards.test.ts` purely to keep both files under the repo's 300-line oxlint cap and
// `add-guards.test.ts`'s own dependency count under its cap.

const TEST_TIMEOUT_MS = 30_000;

type ErrorEnvelope = {
  error?: { code: string; message: string };
  ok: boolean;
};

describe('refs add: SHA-256 (--object-format=sha256) repo head_sha guard', () => {
  it(
    '(l) finalize fails validation (exit 3) before any write when the checkout is a SHA-256 repo',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ objectFormat: 'sha256', tags: ['v1.0.0'] });

          await run(ctx, [
            'node',
            'refs',
            'add',
            fixture.url,
            '--description',
            'A sha256 fixture repo.',
            '--json',
          ]);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).toMatch(/HEAD sha refs cannot store/u);
          const resolved = await resolveAddSource(ctx, fixture.url);
          await expectRefNotConfigured(resolveHome(ctx.env), resolved.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: checkout reuse — managed-checkout marker guard', () => {
  it(
    '(m) dry-run conflicts (exit 5) when the checkout at the derived path is a real, unmanaged manual clone (matching origin, no refs-managed marker)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, dest, sourceUrl, stdout } = await setupSourceFixture(homeDir);
          await createManualCheckout(sourceUrl, dest);

          await run(ctx, ['node', 'refs', 'add', sourceUrl, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('conflict');
          expect(envelope.error?.message).toMatch(/not refs-managed/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: checkout finalize — managed-checkout marker guard', () => {
  it(
    '(o) finalize conflicts (exit 5) and never persists config when the checkout became an ' +
      'unmanaged manual clone (same origin) between dry-run and finalize',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, dest, home, proposal, sourceUrl, stdout } =
            await setupDryRunFixture(homeDir);
          await rm(dest, { force: true, recursive: true });
          await createManualCheckout(sourceUrl, dest);
          const completed = { ...proposal, description: 'A fixture repo.' };

          await finalizeViaProposalFile(ctx, homeDir, completed);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('conflict');
          await expectRefNotConfigured(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: checkout identity — unparseable expected url', () => {
  it(
    '(p) finalize conflicts (exit 5, actionable identity-mismatch message) rather than a ' +
      'generic validation error when the proposal url itself does not parse as a git url',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, home, proposal, stdout } = await setupDryRunFixture(homeDir);
          const completed = {
            ...proposal,
            description: 'A fixture repo.',
            url: 'not-a-supported-git-url',
          };

          await finalizeViaProposalFile(ctx, homeDir, completed);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('conflict');
          expect(envelope.error?.message).toMatch(/expected 'not-a-supported-git-url'/u);
          await expectRefNotConfigured(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: checkout identity — credentialed expected url is redacted', () => {
  it(
    '(q) finalize with a credentialed proposal url never echoes its password into the conflict message',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, home, proposal, stdout } = await setupDryRunFixture(homeDir);
          // Only a non-empty string is required by `zFinalProposal`, so a credentialed url
          // reaches `ensureCheckoutOrigin` as `expectedUrl` verbatim (review round 2, Task 30).
          const completed = {
            ...proposal,
            description: 'A fixture repo.',
            url: 'https://token:sekrit2@example.com/acme/widgets.git',
          };

          await finalizeViaProposalFile(ctx, homeDir, completed);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).not.toContain('sekrit2');
          expect(envelope.error?.message).toContain('<redacted>@example.com');
          await expectRefNotConfigured(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: checkout identity — cosmetic url variance', () => {
  it(
    '(n) finalize does NOT conflict when the proposal url differs from the checkout origin only by a trailing .git',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, dest, proposal, stdout } = await setupDryRunFixture(homeDir);
          const canonicalOrigin = 'https://example.com/acme/widgets';
          await setCheckoutOrigin(dest, canonicalOrigin);
          const completed = {
            ...proposal,
            description: 'A fixture repo.',
            url: `${canonicalOrigin}.git`,
          };

          await finalizeViaProposalFile(ctx, homeDir, completed);

          const envelope = parseLastEnvelope(stdout) as {
            data: { entry: { url: string }; key: string };
            ok: boolean;
          };
          expect(envelope.ok).toBe(true);
          expect(envelope.data.entry.url).toBe(`${canonicalOrigin}.git`);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
