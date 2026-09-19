import { describe, expect, it } from 'vitest';
import {
  expectCheck,
  expectGitVersion,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { chmod } from 'node:fs/promises';
import { sep } from 'node:path';

// `home-modes` — what `refs init` sets, checked on a home that already exists.
//
// `init` creates everything refs owns with explicit modes and repairs them when re-run. That repair
// is the fix; this check is what makes it findable. A home created by an older refs under a
// permissive umask keeps whatever it got, and somebody who upgrades and only ever runs `sync` is
// never told — `hooks/` most of all, since every managed checkout points `core.hooksPath` there and
// git resolves hook NAMES against it.
//
// POSIX only: Windows carries no permission bits that say who may write, and `chmod` there does not
// produce the state under test.

const onWindows = sep === '\\';
/** What `umask 000` leaves behind, which is the case this exists for. */
const WORLD_WRITABLE = 0o777;
const WORLD_READABLE_FILE = 0o644;

describe.skipIf(onWindows)('refs doctor: the modes on a home refs owns', () => {
  it('is quiet on a home init just created', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'home-modes', {
          detailContains: 'reachable only by its owner',
          status: 'ok',
        });
      }),
    );
  });

  it('names every entry a permissive umask left open, and the directory git reads', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await chmod(home.root, WORLD_WRITABLE);
        await chmod(home.hooksDir, WORLD_WRITABLE);
        await chmod(home.configPath, WORLD_READABLE_FILE);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'home-modes', {
          // `hooks/` is the one that turns a permission into code execution, so it has to be named
          // rather than folded into a count.
          detailContains: 'hooks/ is 777 (expected 700)',
          status: 'warn',
        });
      }),
    );
  });
});

describe.skipIf(onWindows)('refs doctor: the modes on the files refs writes', () => {
  it('names them too, not only the directories', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await chmod(home.configPath, WORLD_READABLE_FILE);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        // `config.toml` may hold a credential-bearing url, so it is not a directory-only concern.
        expectCheck(envelope, 'home-modes', {
          detailContains: 'config.toml is 644 (expected 600)',
          status: 'warn',
        });
      }),
    );
  });
});

describe.skipIf(onWindows)('refs doctor: repairing a home whose modes are wrong', () => {
  it('points at the command that does it', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await chmod(home.hooksDir, WORLD_WRITABLE);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        // Not a `chmod` line with a path interpolated into it: `init` already sets every one of
        // these, is idempotent, and needs no value from the caller.
        expectCheck(envelope, 'home-modes', { detailContains: 'run: refs init', status: 'warn' });
      }),
    );
  });
});
