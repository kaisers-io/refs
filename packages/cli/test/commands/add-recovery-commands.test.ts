import { EXIT, readConfig } from '@kaisers-io/refs-core';
import { corruptCheckoutHead, setupDryRunFixture } from '../helpers/add-guards-support.ts';
import { describe, expect, it } from 'vitest';
import {
  finalizeViaProposalFile,
  parseLastEnvelope,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { run } from '../../src/main.ts';

// The commands `refs add --proposal` prints when the checkout its dry-run created is missing or
// corrupt. Each case asserts the printed text, then follows it, because a recovery that names the
// right commands but does not work is the same bug as one that names a `<source>` placeholder.

type ErrorEnvelope = { error?: { message: string }; ok: boolean };
type Breakage = 'corrupt' | 'missing';
type Fixture = Awaited<ReturnType<typeof setupDryRunFixture>>;

const completed = (proposal: object): unknown => ({ ...proposal, description: 'A fixture repo.' });

/** Breaks the dry-run's checkout, finalizes, and returns the refusal's message. */
const refusal = async (homeDir: string, breakage: Breakage): Promise<[Fixture, string]> => {
  const fixture = await setupDryRunFixture(homeDir);
  await (breakage === 'missing'
    ? rm(fixture.dest, { force: true, recursive: true })
    : corruptCheckoutHead(fixture.dest));
  await finalizeViaProposalFile(fixture.ctx, homeDir, completed(fixture.proposal));
  const envelope = parseLastEnvelope(fixture.stdout) as ErrorEnvelope;
  return [fixture, envelope.error?.message ?? ''];
};

/** Does what the corrupt-checkout recovery says, then finalizes the same proposal again. */
const followRecovery = async (ctx: CliContext, homeDir: string, fx: Fixture): Promise<void> => {
  process.exitCode = undefined;
  await rm(fx.dest, { force: true, recursive: true });
  await run(ctx, ['node', 'refs', 'add', fx.sourceUrl, '--dry-run', '--json']);
  await finalizeViaProposalFile(ctx, homeDir, completed(fx.proposal));
};

const configuredKeys = async (fx: Fixture): Promise<string[]> => {
  const config = await readConfig(fx.home);
  return Object.keys(config.refs);
};

describe('refs add --proposal: what a missing checkout prints', () => {
  it(
    'names the source and the proposal file, not a placeholder',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const [fx, message] = await refusal(homeDir, 'missing');

          expect(process.exitCode).toBe(EXIT.NOT_FOUND);
          expect(message).not.toContain('<source>');
          expect(message).toContain(
            `run: refs add '${fx.sourceUrl}' --dry-run --json, then ` +
              `refs add --proposal='${join(homeDir, 'proposal.json')}'`,
          );
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --proposal: what a corrupt checkout prints', () => {
  it(
    'tells a ref still being added to remove the checkout, not to `refs remove` it',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const [fx, message] = await refusal(homeDir, 'corrupt');

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          expect(message).not.toContain('refs remove');
          expect(message).toContain(
            `run: rm -rf -- '${fx.dest}', then refs add '${fx.sourceUrl}' --dry-run --json`,
          );
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'and following it configures the ref',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const [fx] = await refusal(homeDir, 'corrupt');

          await followRecovery(fx.ctx, homeDir, fx);

          expect(process.exitCode).toBeUndefined();
          await expect(configuredKeys(fx)).resolves.toContain(fx.proposal.key);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
