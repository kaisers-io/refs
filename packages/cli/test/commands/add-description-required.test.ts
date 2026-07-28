import { EXIT, readConfig, readState, resolveHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';

// Regression suite for the removed `--description` one-shot fallback: `refs add <source>
// --description <text>` used to silently reuse `<text>` as the description for every DETECTED
// package still missing one (see the former `add-guards.test.ts` "monorepo fallback" case). That
// fallback made per-package descriptions non-mandatory in practice — this suite pins the
// replacement contract instead: the one-shot only ever succeeds when every detected package
// already carries its own description; otherwise it fails closed (exit 3), naming every package
// still missing one, before anything is written to config or state. The single-package (npm:
// source, no workspace detection) failure case is covered as a pure unit test in
// `add-packages.test.ts` instead — same reasoning as `add.test.ts`'s own npm: unit test: there is
// no way to resolve an `npm:<pkg>` source to a local `file://` fixture end-to-end. Kept out of
// `add-guards.test.ts` purely to keep both files under the repo's 300-line oxlint cap.

const TEST_TIMEOUT_MS = 30_000;
const TWO_PACKAGES = 2;
const NO_REFS = 0;

type ErrorEnvelope = {
  error?: { code: string; message: string };
  ok: boolean;
};

type FinalizeEnvelope = {
  data: {
    entry: { description: string; packages?: Record<string, { description: string }> };
    key: string;
  };
  ok: boolean;
};

type OneShotResult = {
  ctx: CliContext;
  stdout: string[];
};

/** Runs `refs add <fixture.url> --description "A fixture monorepo." --json` against a fresh temp
 * home, for the given monorepo fixture `opts` — kept out of the test bodies so each individual
 * `it` stays under the repo's `max-statements` cap and can assert its own subset of the outcome. */
const runMonorepoOneShot = async (
  homeDir: string,
  opts: { monorepoAllDescribed?: boolean; monorepoEmptyDescription?: boolean },
): Promise<OneShotResult> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ ...opts, monorepo: true, tags: ['v1.0.0'] });
  await run(ctx, [
    'node',
    'refs',
    'add',
    fixture.url,
    '--description',
    'A fixture monorepo.',
    '--json',
  ]);
  return { ctx, stdout };
};

/** `envelope.data.entry.packages` normalized to a plain record — a top-level helper (rather than a
 * `??` fallback inline in a test body) so its conditional never runs afoul of
 * `vitest/no-conditional-in-test` (mirrors `add.test.ts`'s own `withDescription` helper). */
const packagesOf = (
  entry: FinalizeEnvelope['data']['entry'],
): Record<string, { description: string }> => entry.packages ?? {};

describe('refs add --description: fails when a detected package has no description', () => {
  it(
    '(l) a mixed monorepo (one package described, one not) fails (exit 3) naming only the missing one',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { stdout } = await runMonorepoOneShot(homeDir, {});

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).toContain('@fixture/b');
          expect(envelope.error?.message).not.toContain('@fixture/a');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(l2) names the two-phase flow and writes nothing to config or state',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, stdout } = await runMonorepoOneShot(homeDir, {});

          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.error?.message).toMatch(/run the two-phase flow instead/u);
          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          const state = await readState(home);
          expect(Object.keys(config.refs)).toHaveLength(NO_REFS);
          expect(Object.keys(state.refs)).toHaveLength(NO_REFS);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --description: an empty-string manifest description counts as missing', () => {
  it(
    '(l3) a package whose manifest description is "" (the npm init -y scaffold) fails the guard',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { stdout } = await runMonorepoOneShot(homeDir, { monorepoEmptyDescription: true });

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).toContain('@fixture/b');
          expect(envelope.error?.message).toMatch(/packages without a detected description/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add --description: succeeds when every detected package already has one', () => {
  it(
    '(m) a monorepo where both packages are already described finalizes with the top-level description',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { stdout } = await runMonorepoOneShot(homeDir, { monorepoAllDescribed: true });

          expect(process.exitCode).toBeUndefined();
          const envelope = parseLastEnvelope(stdout) as FinalizeEnvelope;
          expect(envelope.ok).toBe(true);
          expect(envelope.data.entry.description).toBe('A fixture monorepo.');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '(m2) keeps each package’s own description rather than the top-level one',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { stdout } = await runMonorepoOneShot(homeDir, { monorepoAllDescribed: true });

          const envelope = parseLastEnvelope(stdout) as FinalizeEnvelope;
          const packages = packagesOf(envelope.data.entry);
          expect(Object.keys(packages)).toHaveLength(TWO_PACKAGES);
          expect(packages['@fixture/a']?.description).toBe('Fixture package A');
          expect(packages['@fixture/b']?.description).toBe('Fixture package B');
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
