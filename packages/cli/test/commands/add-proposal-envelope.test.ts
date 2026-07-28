import { EXIT, resolveHome, zProposal } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectFinalizedState,
  expectKeysAbsentFromConfig,
  finalizeViaProposalFile,
  finalizeViaStdinProposal,
  initHome,
  parseLastEnvelope,
  realContextFor,
  runFinalizeExpectingValidationError,
  validFinalProposal,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { ErrorEnvelope } from '../helpers/add-support.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';

// Regression coverage for the dry-run `--json` envelope being accepted by `refs add --proposal`
// (the pipe workflow `refs add ... --dry-run --json > f.json` then `refs add --proposal f.json`
// documented in `docs/commands.md`) — split out of `add.test.ts` purely to keep that file under
// the repo's 300-line oxlint cap.

const TEST_TIMEOUT_MS = 30_000;

type Envelope = {
  data: unknown;
  ok: boolean;
  warnings: string[];
};

/** Like `add-support.ts`'s `runAddDryRunJson`, but returns the FULL envelope (`{ok, data,
 * warnings}`) rather than just the validated `data` — these tests need the real envelope
 * wrapper itself, not merely the proposal it carries. */
const runAddDryRunEnvelope = async (
  ctx: CliContext,
  stdout: string[],
  source: string,
): Promise<Envelope> => {
  await run(ctx, ['node', 'refs', 'add', source, '--dry-run', '--json']);
  return parseLastEnvelope(stdout) as Envelope;
};

const withDescriptions = (proposal: ReturnType<typeof zProposal.parse>): unknown => ({
  ...proposal,
  description: 'A fixture repo.',
  packages: Object.fromEntries(
    Object.entries(proposal.packages).map(([name, pkg]) => [
      name,
      { ...pkg, description: pkg.description ?? `${name} package` },
    ]),
  ),
});

describe('refs add --proposal: accepts the full dry-run --json envelope (a file)', () => {
  it(
    'finalizes when the proposal file is the exact dry-run envelope (ok/data/warnings)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ tags: ['v1.0.0'] });

          const envelope = await runAddDryRunEnvelope(ctx, stdout, fixture.url);
          const proposal = zProposal.parse(envelope.data);
          const completedEnvelope = { ...envelope, data: withDescriptions(proposal) };

          await finalizeViaProposalFile(ctx, homeDir, completedEnvelope);

          expect(process.exitCode).toBeUndefined();
          const home = resolveHome(ctx.env);
          await expectFinalizedState(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --proposal: accepts the envelope via stdin', () => {
  it(
    'finalizes when the envelope is piped via stdin (`--proposal -`)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ tags: ['v1.0.0'] });

          const envelope = await runAddDryRunEnvelope(ctx, stdout, fixture.url);
          const proposal = zProposal.parse(envelope.data);
          const completedEnvelope = { ...envelope, data: withDescriptions(proposal) };

          await finalizeViaStdinProposal(ctx, completedEnvelope);

          expect(process.exitCode).toBeUndefined();
          const home = resolveHome(ctx.env);
          await expectFinalizedState(home, proposal.key);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --proposal: a failed (`ok: false`) envelope', () => {
  it(
    'fails clearly instead of a raw zod dump (exit 3, code validation)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const failedEnvelope = {
            error: { code: 'conflict', message: "ref 'x' already exists" },
            ok: false,
          };

          await finalizeViaProposalFile(ctx, homeDir, failedEnvelope);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.code).toBe('validation');
          expect(envelope.error?.message).toMatch(/failed refs envelope.*re-run the dry-run/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --proposal: a hybrid proposal+envelope object', () => {
  it(
    'does not unwrap (top-level proposal fields plus an ok/data envelope wrapper)',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const topKey = 'github.com/alpha/one';
          const nestedKey = 'github.com/beta/two';
          const hybrid = {
            ...validFinalProposal(topKey),
            data: validFinalProposal(nestedKey),
            ok: true,
            warnings: [],
          };

          const envelope = await runFinalizeExpectingValidationError(
            { ctx, homeDir, stdout },
            hybrid,
          );

          expect(envelope.error?.message).not.toMatch(/failed refs envelope/u);
          expect(envelope.error?.message).not.toMatch(/usable data object/u);
          await expectKeysAbsentFromConfig(ctx, [nestedKey, topKey]);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --proposal: a bare proposal with a stray `ok: false` key', () => {
  it(
    'fails as a strict-schema error, not the misleading envelope message',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const proposalWithStrayOk = {
            ...validFinalProposal('github.com/gamma/three'),
            ok: false,
          };

          const envelope = await runFinalizeExpectingValidationError(
            { ctx, homeDir, stdout },
            proposalWithStrayOk,
          );

          expect(envelope.error?.message).not.toMatch(/failed refs envelope/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --proposal: an envelope-shaped object without a usable data object', () => {
  it.each([
    ['a non-object data payload', { data: 'not-an-object', ok: true, warnings: [] }],
    ['a missing data field', { ok: true, warnings: [] }],
  ])(
    'fails clearly for %s',
    async (_label, envelopeBody) => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);

          const envelope = await runFinalizeExpectingValidationError(
            { ctx, homeDir, stdout },
            envelopeBody,
          );

          expect(envelope.error?.message).toMatch(/usable data object/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
