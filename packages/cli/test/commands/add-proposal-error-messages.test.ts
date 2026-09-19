import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  runFinalizeExpectingValidationError,
  validFinalProposal,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { ErrorEnvelope } from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { writeFile } from 'node:fs/promises';

// Regression coverage for `parseFinalProposal`'s (`add-proposal-io.ts`) legible-error rendering:
// zod's own default rendering of a strict-object's `unrecognized_keys` issue has an EMPTY path
// (there's no field to point a `→ at <path>` line at), and — worse — the CLI's own shipped bundle
// degrades even the issue's default MESSAGE too: `zod`'s `package.json` claims `"sideEffects":
// false`, which is not true of its module-scope default-locale registration, so tsdown/rolldown
// tree-shakes that registration out of `dist/refs.mjs` (the tsdown bundle; `bin/refs.mjs` is only
// the committed stub that loads it) and every un-customized zod issue in the shipped binary
// renders as a bare `Invalid input` there — no path, no offending key, no detail
// (this unbundled test suite never reproduces that particular degradation, since it runs against
// source; `formatProposalError`'s job is to stop depending on `.message` at all for exactly this
// case, reading `.keys` off the issue object instead, which is unaffected by the bug either way).
// Split out of `add-proposal-envelope.test.ts` purely to keep both files under the repo's 300-line
// oxlint cap.

describe('refs add --proposal: a stray unrecognized top-level key', () => {
  it(
    'names the offending key instead of a bare "Invalid input"',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const proposalWithStrayKey = {
            ...validFinalProposal('github.com/delta/four'),
            okay: true,
          };

          const envelope = await runFinalizeExpectingValidationError(
            { ctx, homeDir, stdout },
            proposalWithStrayKey,
          );

          expect(envelope.error?.message).toMatch(/unrecognized key\(s\) in proposal: "okay"/u);
          expect(envelope.error?.message).not.toBe('✖ Invalid input');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --proposal: more than one stray unrecognized top-level key', () => {
  it(
    'names every stray key',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const proposalWithStrayKeys = {
            ...validFinalProposal('github.com/echo/five'),
            extra: 1,
            okay: true,
          };

          const envelope = await runFinalizeExpectingValidationError(
            { ctx, homeDir, stdout },
            proposalWithStrayKeys,
          );

          expect(envelope.error?.message).toContain('"extra"');
          expect(envelope.error?.message).toContain('"okay"');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --proposal: a stray unrecognized key nested inside a package entry', () => {
  it(
    'names the key with its package path instead of a bare "Invalid input → at packages.ms"',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const proposalWithNestedStrayKey = {
            ...validFinalProposal('github.com/golf/seven'),
            packages: { ms: { bogus: true, description: 'A package.', path: '.' } },
          };

          const envelope = await runFinalizeExpectingValidationError(
            { ctx, homeDir, stdout },
            proposalWithNestedStrayKey,
          );

          expect(envelope.error?.message).toMatch(
            /unrecognized key\(s\) in proposal at packages\.ms: "bogus"/u,
          );
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --proposal: a named-path issue still renders with its full nested path', () => {
  it(
    'a package missing its own required description still names `packages.<name>.description`',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const proposalWithBarePackage = {
            ...validFinalProposal('github.com/foxtrot/six'),
            packages: { ms: { path: '.' } },
          };

          const envelope = await runFinalizeExpectingValidationError(
            { ctx, homeDir, stdout },
            proposalWithBarePackage,
          );

          expect(envelope.error?.message).toContain('packages.ms.description');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

// `JSON.parse` embeds the offending input in its message for SOME malformations and not others —
// measured on Node 24, `{"url":SECRET}` comes back as
// ``Unexpected token 'S', "{"url":SECRET}" is not valid JSON``. A proposal is a document someone
// filled in by hand, quite possibly with a credentialed url in it, and the message goes into the
// `--json` error envelope. It carries no structured position either, so nothing a caller could act
// on is lost by not forwarding it.
const PLANTED_SECRET = 'SECRET_TOKEN_abc123';

describe('refs add --proposal: a document that is not valid JSON', () => {
  it(
    'reports the failure without the parser message or the document',
    { timeout: SLOW_IO_TIMEOUT_MS },
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const path = join(homeDir, 'broken.json');
          // The input-embedding shape specifically: a bare token where a value belongs.
          await writeFile(path, `{"url":${PLANTED_SECRET}}`);

          await run(ctx, ['node', 'refs', 'add', '--proposal', path, '--json']);

          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.error?.message).toBe(
            'invalid JSON in proposal: the document could not be parsed',
          );
        }),
      );
    },
  );
});
