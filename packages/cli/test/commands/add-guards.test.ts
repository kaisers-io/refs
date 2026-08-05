import type { CloneMode, Proposal } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { EXIT, readConfig, resolveHome, writeConfig } from '@kaisers-io/refs-core';
import {
  corruptCheckoutHead,
  createBogusCheckout,
  expectCheckoutReused,
  expectRefNotConfigured,
  markCheckout,
  setCheckoutOrigin,
  setupDryRunFixture,
  setupSourceFixture,
} from '../helpers/add-guards-support.ts';
import { describe, expect, it } from 'vitest';
import {
  expectPendingProposal,
  finalizeViaProposalFile,
  parseLastEnvelope,
  runAddDryRunJson,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';
import { writePendingProposal } from '../../src/commands/add-dry-run.ts';

// Regression suite for `refs add`'s two-phase flow, covering the guards added on top
// of its original implementation: atomic/checked finalize (rev-parse under the ref lock,
// never nested with the home lock), checkout-identity verification (reused checkouts and
// finalize targets must still point at the expected origin), the dry-run/finalize race guard, and
// a permanent repeated-`--dry-run` regression test. Kept out of `add.test.ts` (cases (a)-(e))
// purely to keep both files under the repo's 300-line oxlint cap; shared scaffolding lives in
// `test/helpers/add-support.ts`. (The former `--description` monorepo-fallback case now lives in
// `add-description-required.test.ts` — that fallback was removed; see its own header comment.)

const TEST_TIMEOUT_MS = 30_000;
const BOGUS_ORIGIN = 'https://example.com/someone/else.git';
// A `git remote get-url origin` value carrying an embedded credential — the secret-echo case
// For the origin-mismatch conflict message below.
const CREDENTIALED_BOGUS_ORIGIN = 'https://token:sekrit@example.com/someone/else.git';
// A named `CloneMode | undefined` value rather than a literal `undefined` at the call site below
// (the race-guard test calls `writePendingProposal` directly, whose third parameter is required
// but typed to allow `undefined` — mirroring `add.ts`'s own `--proposal` finalize path, which never
// knows a fresh `effectiveCloneMode`).
const NO_CLONE_MODE_OVERRIDE: CloneMode | undefined = undefined;

type ErrorEnvelope = {
  error?: { code: string; message: string };
  ok: boolean;
};

// `--dry-run` proposals default `description` to `''` (a human is expected to fill it in before
// finalizing — see `zFinalProposal`'s non-empty requirement); these guard tests finalize against a
// plain (non-monorepo) fixture, so no per-package descriptions need filling in, only this one.
const completeProposal = (proposal: Proposal): unknown => ({
  ...proposal,
  description: 'A fixture repo.',
});

describe('refs add --proposal: corrupt checkout guard', () => {
  it(
    '(f) finalize fails validation (exit 3) and never persists config when rev-parse HEAD fails',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, dest, home, proposal, stdout } = await setupDryRunFixture(homeDir);
          await corruptCheckoutHead(dest);

          await finalizeViaProposalFile(ctx, homeDir, completeProposal(proposal));

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).toMatch(/rev-parse HEAD failed/u);
          await expectRefNotConfigured(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: checkout identity verification', () => {
  it(
    '(g) dry-run conflicts (exit 5) when an existing checkout at the derived path has a different origin',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, dest, sourceUrl, stdout } = await setupSourceFixture(homeDir);
          await createBogusCheckout(dest, BOGUS_ORIGIN);

          await run(ctx, ['node', 'refs', 'add', sourceUrl, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('conflict');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(h) finalize conflicts (exit 5) when the checkout origin no longer matches the proposal url',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, dest, home, proposal, stdout } = await setupDryRunFixture(homeDir);
          await setCheckoutOrigin(dest, BOGUS_ORIGIN);

          await finalizeViaProposalFile(ctx, homeDir, completeProposal(proposal));

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

// Secret-echo regression: kept in its own `describe` (rather than folded into "checkout
// identity verification" above) purely to keep that block's function under the repo's
// 50-line-per-function oxlint cap.
describe('refs add: origin-mismatch message redacts embedded credentials', () => {
  it(
    '(i) the origin-mismatch message redacts embedded credentials from the actual checkout origin',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, dest, sourceUrl, stdout } = await setupSourceFixture(homeDir);
          await createBogusCheckout(dest, CREDENTIALED_BOGUS_ORIGIN);

          await run(ctx, ['node', 'refs', 'add', sourceUrl, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('conflict');
          expect(envelope.error?.message).not.toContain('sekrit');
          expect(envelope.error?.message).toContain('<redacted>@example.com');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

// Unit-level, per the task brief's fallback instruction: there is no clean seam to actually race a
// `--dry-run` against a concurrent finalize inside a single test process, so this exercises
// `writePendingProposal`'s home-locked re-check directly — it is exported specifically for this.
describe('refs add --dry-run: pending-proposal race guard', () => {
  it(
    'writePendingProposal refuses to re-add pending_proposal_at once the ref is already configured',
    async () => {
      expect.hasAssertions();
      await withTempHome(async (homeDir) => {
        const { home, resolved } = await setupSourceFixture(homeDir);
        const config = await readConfig(home);
        config.refs[resolved.key] = {
          default_branch: 'main',
          description: 'already configured by a racing finalize',
          tag_format: 'v{version}',
          url: resolved.cloneUrl,
        };
        await writeConfig(home, config);

        await expect(
          writePendingProposal(home, resolved.key, NO_CLONE_MODE_OVERRIDE),
        ).rejects.toThrow(/already exists/u);
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --dry-run: repeated on the same source', () => {
  it(
    '(i) a second --dry-run reuses the clone and overwrites pending_proposal_at without conflict',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const {
            ctx,
            dest,
            home,
            proposal: first,
            sourceUrl,
            stdout,
          } = await setupDryRunFixture(homeDir);
          await markCheckout(dest);

          const second = await runAddDryRunJson(ctx, stdout, sourceUrl);

          expect(second.key).toBe(first.key);
          await expectCheckoutReused(dest);
          await expectPendingProposal(home, first.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: case-collision guard', () => {
  it(
    '(k) dry-run conflicts (exit 5) when a checkout dir differs from the new key only by case',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // No real git clone happens here: `ensureNoCaseCollision` runs (and throws) before
          // `runDryRunCore` ever touches the runner, so a scripted `FakeRunner` (via `testContext`)
          // is enough — no `SpawnRunner`/`file://` fixture needed for this guard alone. macOS's
          // default filesystem is case-insensitive but case-PRESERVING (`readdir` returns entries
          // in their originally-created case), so pre-creating `.../Acme/repo` and then resolving
          // a key of `.../acme/repo` genuinely exercises the guard's own case-insensitive
          // comparison on disk, on macOS and Linux alike.
          const { ctx, stdout } = testContext();
          ctx.env['REFS_HOME'] = homeDir;
          await run(ctx, ['node', 'refs', 'init']);
          const home = resolveHome(ctx.env);
          await mkdir(join(home.sourcesDir, 'github.com', 'Acme', 'repo'), { recursive: true });

          await run(ctx, [
            'node',
            'refs',
            'add',
            'https://github.com/acme/repo.git',
            '--dry-run',
            '--json',
          ]);

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
