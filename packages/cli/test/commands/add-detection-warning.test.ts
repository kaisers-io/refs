import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import type { CliContext } from '../../src/context.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { run } from '../../src/main.ts';

// What a dry-run says when workspace detection could not read the repository's own declaration.
//
// An empty `packages` record is not self-explanatory: it is also exactly what an ordinary
// single-package repository produces. So a repository declaring a pattern the classifier cannot
// expand used to hand back a package-less proposal indistinguishable from a legitimate one, and `ADD.md` gives the agent no reason to doubt it. The configuration was then
// built empty, and the drift probe never runs for a ref that configures no packages, so nothing
// downstream could recover it either (#106).

const ROOT_AND_TWO_MEMBERS = 3;
const ONE_WARNING = 1;

type DryRunEnvelope = {
  data: { packages: Record<string, unknown> };
  warnings: string[];
};

type DryRunResult = {
  ctx: CliContext;
  envelope: DryRunEnvelope;
};

/** A dry-run against a fresh temp home and a monorepo fixture, with the workspace pattern the
 * caller asks for — kept out of the test bodies so each stays under `max-statements`. */
const dryRunAgainst = async (
  homeDir: string,
  unsupportedPattern: boolean,
): Promise<DryRunResult> => {
  const { ctx, stdout } = realContextFor(homeDir);
  await initHome(ctx);
  const fixture = await createFixtureRepo({ monorepo: true, unsupportedPattern });
  await run(ctx, ['node', 'refs', 'add', fixture.url, '--dry-run', '--json']);
  return { ctx, envelope: parseLastEnvelope(stdout) as DryRunEnvelope };
};

/** The warnings that are about detection, not about the clone — a fixture remote never honours
 * `--filter=blob:none`, so a partial-clone warning is present in every case here. */
const detectionWarnings = (envelope: DryRunEnvelope): string[] =>
  envelope.warnings.filter((warning) => warning.includes('workspace detection'));

describe('refs add --dry-run: a workspace declaration detection could not read', () => {
  it(
    'finds no member, and names what stopped it rather than letting the result speak for itself',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { envelope } = await dryRunAgainst(homeDir, true);

          // Worse than an empty record: the root is found by looking rather than by the pattern,
          // so the proposal comes back with one plausible-looking entry while both members are
          // missing. Nothing in it suggests anything went wrong.
          expect(Object.keys(envelope.data.packages)).toStrictEqual(['fixture-root']);
          expect(detectionWarnings(envelope)).toStrictEqual([
            'workspace detection could not fully inspect the declared workspaces ' +
              '(packages/{a,b}: unsupported_pattern) — members may be missing from the detected ' +
              "packages; the repository's own workspace declaration is what settles it",
          ]);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'still reports the clone warning alongside it',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // Two independent facts about one run. Neither may displace the other — a partial-clone
          // fallback and an unreadable declaration are different problems with different fixes.
          const { envelope } = await dryRunAgainst(homeDir, true);

          expect(envelope.warnings.some((warning) => warning.includes('partial-clone'))).toBe(true);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --description: the same warning on the one-shot path', () => {
  it(
    'finalizes, and still says the detected packages may be short',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // The one-shot shares `runDryRunCore`, and the detected root passes the description guard,
          // so this path succeeds and writes the config entry. Without its own case, removing the
          // warning from here alone would escape every test above.
          const { ctx, stdout } = realContextFor(homeDir);
          await initHome(ctx);
          const fixture = await createFixtureRepo({ monorepo: true, unsupportedPattern: true });
          await run(ctx, [
            'node',
            'refs',
            'add',
            fixture.url,
            '--description',
            'A fixture monorepo.',
            '--json',
          ]);

          const envelope = parseLastEnvelope(stdout) as DryRunEnvelope & { ok: boolean };
          expect(envelope.ok).toBe(true);
          expect(detectionWarnings(envelope)).toHaveLength(ONE_WARNING);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'words it for a run that has already written the entry',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // By the time a reader sees this, the config entry exists. Telling them to check something
          // "before approving" would describe a step that is over.
          const { envelope } = await dryRunAgainst(homeDir, true);

          expect(detectionWarnings(envelope)[0]).not.toMatch(/approv/iu);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('refs add --dry-run: a declaration detection reads fine', () => {
  it(
    'says nothing about detection, and finds the packages',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // The control. Without it the assertion above would hold for a warning emitted on every
          // run, which would be noise rather than a finding.
          const { envelope } = await dryRunAgainst(homeDir, false);

          expect(Object.keys(envelope.data.packages)).toHaveLength(ROOT_AND_TWO_MEMBERS);
          expect(detectionWarnings(envelope)).toStrictEqual([]);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
