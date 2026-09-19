import { DIR_MODE, FILE_MODE, SpawnRunner, resolveHome } from '@kaisers-io/refs-core';
import { chmod, mkdir, mkdtemp, stat, symlink } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  initHome,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { cliBundle } from '../helpers/printed-command.ts';
import { join } from 'node:path';
import { shellQuote } from '../../src/shell-quote.ts';
import { tmpdir } from 'node:os';

// What refs owns under `REFS_HOME` used to be masked by whatever umask the invoking process
// happened to carry. Measured before this changed, on a home created by the built CLI:
//
//   umask 022 -> drwxr-xr-x hooks   (fine)
//   umask 002 -> drwxrwxr-x hooks   (any member of the group may write)
//   umask 000 -> drwxrwxrwx hooks   (anyone may write)
//
// `hooks/` is the directory every managed checkout points `core.hooksPath` at, and git resolves
// hook NAMES against it — so a second local principal able to write there gets code executed as
// the refs user during an ordinary `refs sync`. Under the default umask the question does not
// arise, which is exactly the problem: refs neither chose nor recorded which of those it got.
//
// Skipped on Windows, where these bits are not the access-control mechanism.

const PERMISSION_BITS = 0o777;
const PERMISSIVE_DIR = 0o777;
const OWNER_EXECUTE = 0o100;
const SHARED_DIR = 0o755;
const WORLD_WRITABLE_FILE = 0o666;
const SUCCESS = 0;

const modeOf = async (path: string): Promise<number> => {
  const stats = await stat(path);
  // eslint-disable-next-line no-bitwise -- the file type bits are not what this asserts on
  return stats.mode & PERMISSION_BITS;
};

describe.skipIf(process.platform === 'win32')('what refs init leaves on disk', () => {
  it('gives every directory it owns an explicit mode, whatever the umask was', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = realContextFor(homeDir);
      await initHome(ctx);
      const home = resolveHome(ctx.env);

      const modes = await Promise.all(
        [home.root, home.sourcesDir, home.locksDir, home.hooksDir].map((dir) => modeOf(dir)),
      );

      expect(modes).toStrictEqual([DIR_MODE, DIR_MODE, DIR_MODE, DIR_MODE]);
    });
  });

  it('writes the config with an explicit mode too', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = realContextFor(homeDir);
      await initHome(ctx);
      const home = resolveHome(ctx.env);

      await expect(modeOf(home.configPath)).resolves.toBe(FILE_MODE);
    });
  });

  it('tightens a home that already exists, which mkdir alone would not', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = realContextFor(homeDir);
      const home = resolveHome(ctx.env);
      // The state a home created under a permissive umask is left in. `mkdir` applies a mode only
      // to directories it CREATES, and `init` is the command that repairs a home.
      await mkdir(home.hooksDir, { recursive: true });
      await chmod(home.hooksDir, PERMISSIVE_DIR);

      await initHome(ctx);

      await expect(modeOf(home.hooksDir)).resolves.toBe(DIR_MODE);
    });
  });
});

describe.skipIf(process.platform === 'win32')(
  'what refs init leaves under a permissive umask',
  () => {
    // Through a real subprocess, because a umask is process-wide: setting it inside the worker would
    // reach every test running beside this one. This is also the only shape that exercises creating
    // the home root — `withTempHome` hands over a directory that already exists — so it is the one
    // assertion that sees the mkdir mode rather than the chmod that follows it.
    it.each([
      ['world-writable', '000'],
      ['group-writable', '002'],
    ])('is private anyway: umask %s', { timeout: SLOW_IO_TIMEOUT_MS }, async (_label, mask) => {
      expect.hasAssertions();
      const root = await mkdtemp(join(tmpdir(), 'refs-umask-'));
      const home = join(root, 'home');
      const bundle = await cliBundle();

      const result = await new SpawnRunner().run('sh', [
        '-c',
        `umask ${mask}; REFS_HOME=${shellQuote(home)} node ${shellQuote(bundle)} init --json`,
      ]);

      expect(result.exitCode).toBe(SUCCESS);
      const modes = await Promise.all(
        [home, join(home, 'hooks'), join(home, 'config.toml')].map((path) => modeOf(path)),
      );
      expect(modes).toStrictEqual([DIR_MODE, DIR_MODE, FILE_MODE]);
    });
  },
);

describe.skipIf(process.platform === 'win32')('a home directory that is a symlink', () => {
  it('is left alone, because chmod would change what it points at', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = realContextFor(homeDir);
      const home = resolveHome(ctx.env);
      const elsewhere = await mkdtemp(join(tmpdir(), 'refs-elsewhere-'));
      await chmod(elsewhere, SHARED_DIR);
      await mkdir(home.root, { recursive: true });
      await symlink(elsewhere, home.sourcesDir);

      await initHome(ctx);

      // Pointing `sources` at another disk is a legitimate thing to do, and the mode of that
      // directory is its owner's business — refs does not own it and was never asked about it.
      await expect(modeOf(elsewhere)).resolves.toBe(SHARED_DIR);
    });
  });
});

describe.skipIf(process.platform === 'win32')('a config left readable by an older refs', () => {
  it('is tightened by init even when nothing rewrites it', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = realContextFor(homeDir);
      await initHome(ctx);
      const home = resolveHome(ctx.env);
      // `stampCliVersionIfChanged` returns without writing when the version already matches, so
      // without an explicit repair this file would keep its mode through every later `init`.
      await chmod(home.configPath, WORLD_WRITABLE_FILE);

      await initHome(ctx);

      await expect(modeOf(home.configPath)).resolves.toBe(FILE_MODE);
    });
  });
});

describe.skipIf(process.platform === 'win32')('a file whose mode cannot be applied', () => {
  it('fails rather than leaving it unrepaired and reporting the home ready', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stderr } = realContextFor(homeDir);
        const home = resolveHome(ctx.env);
        await mkdir(home.root, { recursive: true });
        // A self-referential link: `chmod` follows links, so this answers ELOOP. Only an ABSENT
        // file is an ordinary outcome here — anything else means the repair did not happen, and
        // `init` reporting the home ready would be a claim it had not established.
        await symlink(home.configPath, home.configPath);

        await initHome(ctx);

        expect(stderr.join('\n')).toContain('ELOOP');
      }),
    );
  });
});

describe.skipIf(process.platform === 'win32')('what refs init leaves executable', () => {
  it('keeps the guard hooks executable, which the file mode alone would not', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const { ctx } = realContextFor(homeDir);
      await initHome(ctx);
      const home = resolveHome(ctx.env);

      // `writeFileAtomic` now writes 0600, and `installHooksGuard` chmods afterwards — so this
      // pins that the order of those two is still the one that leaves a runnable hook.
      const mode = await modeOf(join(home.hooksDir, 'pre-commit'));

      // eslint-disable-next-line no-bitwise -- the owner-executable bit is exactly the assertion
      expect(mode & OWNER_EXECUTE).toBe(OWNER_EXECUTE);
    });
  });
});
