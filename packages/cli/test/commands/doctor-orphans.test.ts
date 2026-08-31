import {
  HTTPS_REF_ENTRY,
  expectCheck,
  expectGitVersion,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { checkoutPath, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig, seedState } from '../helpers/ref-fixtures.ts';

// `orphans` — a checkout under `sources/` with no matching config entry. Split out of
// `doctor.test.ts` purely to keep that file under the repo's 300-line oxlint cap.

const ALPHA_KEY = 'github.com/acme/alpha';
const ORPHAN_KEY = 'github.com/acme/leftover';
const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const FRESH_PENDING_HOURS_AGO = 2;
const STALE_PENDING_DAYS_AGO = 2;

const hoursAgoIso = (hoursAgo: number): string =>
  new Date(Date.now() - hoursAgo * MS_PER_HOUR).toISOString();

const daysAgoIso = (daysAgo: number): string => hoursAgoIso(daysAgo * HOURS_PER_DAY);

describe('refs doctor: (c) true orphan checkout', () => {
  it('reports orphans as warn, naming a pasteable rm -rf command', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [ALPHA_KEY]: HTTPS_REF_ENTRY });
        const orphanDest = checkoutPath(home, zRefKey.parse(ORPHAN_KEY));
        await markCheckoutPresent(orphanDest);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'orphans', {
          // Quoted and `--`-terminated: the path can contain spaces (the refs home often does),
          // so an unquoted suggestion would delete the wrong things when pasted.
          detailContains: `orphan — remove with: rm -rf -- '${orphanDest}'`,
          status: 'warn',
        });
      }),
    );
  });

  it('classifies a stale (>24h) pending proposal as a true orphan too', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        const orphanDest = checkoutPath(home, zRefKey.parse(ORPHAN_KEY));
        await markCheckoutPresent(orphanDest);
        await seedState(home, {
          [ORPHAN_KEY]: { pending_proposal_at: daysAgoIso(STALE_PENDING_DAYS_AGO) },
        });
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'orphans', {
          detailContains: 'orphan — remove with:',
          status: 'warn',
        });
      }),
    );
  });
});

describe('refs doctor: fresh pending-add proposal', () => {
  it('reports a <24h pending_proposal_at as "pending add", not an orphan', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        const pendingDest = checkoutPath(home, zRefKey.parse(ORPHAN_KEY));
        await markCheckoutPresent(pendingDest);
        await seedState(home, {
          [ORPHAN_KEY]: { pending_proposal_at: hoursAgoIso(FRESH_PENDING_HOURS_AGO) },
        });
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'orphans', {
          detailContains: `${ORPHAN_KEY}: pending add`,
          status: 'warn',
        });
      }),
    );
  });
});

describe('refs doctor: no orphans', () => {
  it('reports ok when every checkout under sources/ has a config entry', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [ALPHA_KEY]: HTTPS_REF_ENTRY });
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'orphans', { status: 'ok' });
      }),
    );
  });
});
