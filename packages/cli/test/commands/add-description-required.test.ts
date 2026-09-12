import { EXIT, readConfig, readState, resolveHome } from '@kaisers-io/refs-core';
import { SOLO_MANIFEST_DESCRIPTION, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import type { FixtureRepo } from '../helpers/fixture-repo.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { run } from '../../src/main.ts';

// What `refs add <source> --description <text>` may and may not write, end to end.
//
// A package's description is prose about what that package IS, and refs never reads one out of a
// checkout's manifests (`WorkspacePackage` in core carries identity only). The one-shot has a
// single description, about the repository. So it can finalize exactly two shapes: a repo with no
// detected packages (no workspace declaration — core probes no root for those), and one whose
// only detected package is the root at `.`, which IS that repository. Anything else fails closed
// (exit 3), naming every package, before a byte reaches
// config or state; those descriptions have to be written from the source by whoever runs the
// two-phase flow.
//
// The monorepo fixture here deliberately describes EVERY package in its manifests. That is the
// negative control: a suite whose fixture simply lacked descriptions would pass just as well
// against the old behaviour and would pin nothing.
//
// The single-package (npm: source, no workspace detection) case is a pure unit test in
// `add-packages.test.ts` instead — there is no way to resolve an `npm:<pkg>` source to a local
// `file://` fixture end to end. Kept out of `add-guards.test.ts` purely to keep both files under
// the repo's 300-line oxlint cap.

const ONE_PACKAGE = 1;
const NO_REFS = 0;
const REF_DESCRIPTION = 'A fixture monorepo.';

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
  fixture: FixtureRepo;
  stdout: string[];
};

/** Runs the one-shot against a fresh temp home and the given fixture `opts` — kept out of the test
 * bodies so each individual `it` stays under the repo's `max-statements` cap and can assert its
 * own subset of the outcome. */
const runOneShot = async (
  homeDir: string,
  opts: { monorepo?: boolean; monorepoAllDescribed?: boolean; rootOnlyWorkspace?: boolean },
): Promise<OneShotResult> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ ...opts, tags: ['v1.0.0'] });
  await run(ctx, ['node', 'refs', 'add', fixture.url, '--description', REF_DESCRIPTION, '--json']);
  return { ctx, fixture, stdout };
};

/** `envelope.data.entry.packages` normalized to a plain record — a top-level helper (rather than a
 * `??` fallback inline in a test body) so its conditional never runs afoul of
 * `vitest/no-conditional-in-test` (mirrors `add.test.ts`'s own `withDescription` helper). */
const packagesOf = (
  entry: FinalizeEnvelope['data']['entry'],
): Record<string, { description: string }> => entry.packages ?? {};

/** The error message out of a parsed envelope, for the same reason as `packagesOf`. */
const messageOf = (envelope: ErrorEnvelope): string => envelope.error?.message ?? '';

describe('refs add --description: refuses a package it cannot describe', () => {
  it(
    '(l) fails (exit 3) naming every workspace member, though every manifest describes itself',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { stdout } = await runOneShot(homeDir, {
            monorepo: true,
            monorepoAllDescribed: true,
          });

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).toContain('@fixture/a');
          expect(envelope.error?.message).toContain('@fixture/b');
          // The root IS the repository, so it is never among the packages that need one.
          expect(envelope.error?.message).not.toContain('fixture-root');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    '(l2) prints runnable two-phase commands carrying the source it was given',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { fixture, stdout } = await runOneShot(homeDir, { monorepo: true });

          const message = messageOf(parseLastEnvelope(stdout) as ErrorEnvelope);
          // Shell-quoted and concrete, not a `<source>` placeholder: a printed command that
          // cannot be run as printed is a bug (`CLAUDE.md`).
          expect(message).toContain(`refs add '${fixture.url}' --dry-run --json > proposal.json`);
          expect(message).toContain('refs add --proposal proposal.json');
          expect(message).toMatch(/fill in the ref's own description/iu);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --description: what a refusal leaves behind', () => {
  it(
    '(l3) writes nothing to config or state',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx } = await runOneShot(homeDir, { monorepo: true });

          const home = resolveHome(ctx.env);
          const config = await readConfig(home);
          const state = await readState(home);
          expect(Object.keys(config.refs)).toHaveLength(NO_REFS);
          expect(Object.keys(state.refs)).toHaveLength(NO_REFS);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --description: the shapes it still finalizes', () => {
  it(
    '(m) a repository with no detected package at all',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { stdout } = await runOneShot(homeDir, {});

          expect(process.exitCode).toBeUndefined();
          const envelope = parseLastEnvelope(stdout) as FinalizeEnvelope;
          expect(envelope.ok).toBe(true);
          expect(envelope.data.entry.description).toBe(REF_DESCRIPTION);
          expect(envelope.data.entry.packages).toBeUndefined();
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    "(m2) a workspace root alone — and the caller's text wins over the manifest's own",
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { stdout } = await runOneShot(homeDir, { rootOnlyWorkspace: true });

          expect(process.exitCode).toBeUndefined();
          const packages = packagesOf((parseLastEnvelope(stdout) as FinalizeEnvelope).data.entry);
          expect(Object.keys(packages)).toHaveLength(ONE_PACKAGE);
          expect(packages['fixture-solo']).toStrictEqual({
            description: REF_DESCRIPTION,
            path: '.',
          });
          expect(JSON.stringify(packages)).not.toContain(SOLO_MANIFEST_DESCRIPTION);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
