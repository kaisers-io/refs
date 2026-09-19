import { CLAIMS_DIRNAME, EXIT } from '@kaisers-io/refs-core';
import { createManualCheckout, setupSourceFixture } from '../helpers/add-guards-support.ts';
import { describe, expect, it } from 'vitest';
import {
  expectCheck,
  expectGitVersion,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { join, sep } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ErrorEnvelope } from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { parseLastEnvelope } from '../helpers/add-support.ts';
import { run } from '../../src/main.ts';

// Every repair command `doctor` prints carries a filesystem path, and those paths begin with the
// refs home — which is wherever `REFS_HOME` points. A home under a directory whose NAME carries a
// control character therefore makes each of those commands unprintable, not because of anything a
// tracked repository did.
//
// Quoting does not rescue them: `rm -rf -- '/…/a<LF>b/locks/x'` survives a shell, but `displaySafe`
// turns the newline into `?` on the way to the terminal, so the line the reader pastes removes a
// path that is not the one `doctor` found. For a removal that is the whole difficulty — it cannot
// be undone by running it again — so no command is offered and the finding says so.

/** A directory name no printed command can carry, which the home then sits inside. */
const UNPRINTABLE_SEGMENT = 'refs\nhome';
// POSIX only: Windows refuses a control character in a path component, so the fixture cannot be
// created there at all (`ENOENT … mkdir`). What is under test is refs' own decision about what it
// will print, which is not platform-specific; the platform only decides whether such a path can
// exist to begin with.
const onWindows = sep === '\\';

const homeUnderUnprintablePath = async (homeDir: string): Promise<string> => {
  const nested = join(homeDir, UNPRINTABLE_SEGMENT);
  await mkdir(nested, { recursive: true });
  return nested;
};

describe.skipIf(onWindows)('refs doctor: a refs home whose path cannot be printed', () => {
  it('reports a leftover steal claim without a command to clear it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(await homeUnderUnprintablePath(homeDir));
        await mkdir(join(setup.home.locksDir, CLAIMS_DIRNAME, 'home'), { recursive: true });
        expectGitVersion(setup.runner);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, 'locks', {
          detailContains: 'remove that directory by hand',
          status: 'warn',
        });
      }),
    );
  });

  it('reports an unreclaimable lock without a command to remove it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(await homeUnderUnprintablePath(homeDir));
        // Not a lock at all, sitting on a lock name. refs will never touch it, so the command is
        // normally the only way out — which is exactly the line that cannot be printed here.
        await writeFile(join(setup.home.locksDir, 'home'), 'not a lock');
        expectGitVersion(setup.runner);

        const envelope = await runDoctorJson(setup.ctx, setup.stdout);

        expectCheck(envelope, 'locks', {
          detailContains: 'has to be removed by hand',
          status: 'warn',
        });
      }),
    );
  });
});

describe.skipIf(onWindows)('refs add: a refs home whose path cannot be printed', () => {
  it(
    'refuses an unmanaged checkout and tells the reader to remove it by hand',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const nested = await homeUnderUnprintablePath(homeDir);
          const { ctx, dest, sourceUrl, stdout } = await setupSourceFixture(nested);
          await createManualCheckout(sourceUrl, dest);

          await run(ctx, ['node', 'refs', 'add', sourceUrl, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.CONFLICT);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          const message = String(envelope.error?.message);
          expect(message).toMatch(/not refs-managed/u);
          expect(message).toContain('remove it by hand');
          expect(message).not.toContain('rm -rf');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
