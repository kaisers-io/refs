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
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

const ALPHA_KEY = 'github.com/acme/alpha';

// A checkout an older refs cloned has no content-filter guard yet, and `git status` refreshes the
// index, which can run a filter. Doctor leaves it alone until the next sync writes the guard.
describe('refs doctor: a checkout without the content-filter guard', () => {
  it('is not asked for its status, and says so', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, { [ALPHA_KEY]: HTTPS_REF_ENTRY });
        const dest = checkoutPath(home, zRefKey.parse(ALPHA_KEY));
        await markCheckoutPresent(dest);
        await rm(join(dest, '.git', 'info', 'attributes'));
        expectGitVersion(runner);
        runner.expect(
          'git config --local --get core.hooksPath',
          { stdout: home.hooksDir },
          { cwd: dest },
        );

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'dirty-checkouts', {
          detailContains: `switches content filters off there: ${ALPHA_KEY}`,
          status: 'warn',
        });
        expect(runner.calls.map((call) => call.args.join(' '))).not.toContain('status --porcelain');
      }),
    );
  });
});
