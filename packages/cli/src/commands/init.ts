import {
  DIR_MODE,
  FILE_MODE,
  installHooksGuard,
  isEnoent,
  migrateConfig,
  resolveHome,
  withLock,
} from '@kaisers-io/refs-core';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { cliOptsOf, emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import type { RefsHome } from '@kaisers-io/refs-core';
// eslint-disable-next-line import/no-relative-parent-imports -- package.json lives at the package root, one level above src/
import pkg from '../../package.json' with { type: 'json' };

// Printed verbatim in human mode and mirrored into `data.skill_hint` in json mode — this string
// is only ever printed, never executed: `refs init` must stay free of anything network-facing,
// so the actual `npx skills add` install step is left for the human/agent to run.
const SKILL_HINT =
  'Install the agent skill: npx skills add kaisers-io/refs   ' +
  '(from a local clone: npx skills add <path-to-this-repo> --skill refs)';

type InitData = {
  config: 'seeded' | 'migrated' | 'noop';
  home: string;
  skill_hint: string;
};

// `noop` is implementation vocabulary and says nothing to a reader; the json envelope keeps it,
// human output says `unchanged`. Decoupling the two is the premise of the key/value format —
// human keys are not the json field names either (`path`, not `local_path`).
const CONFIG_DISPLAY: Record<InitData['config'], string> = {
  migrated: 'migrated',
  noop: 'unchanged',
  seeded: 'seeded',
};

// Every home subdirectory `init` guarantees exists on return. Init's contract is that all four
// exist unconditionally when it resolves — including on a `'noop'` run that touches neither
// `migrateConfig` nor `installHooksGuard` — so they are created up front here rather than relying
// on the incidental mkdir-recursive calls buried inside those two functions' own atomic-write
// helpers (`withLock` itself also mkdir's `locksDir` recursively, independent of this).
//
// Each is created with an explicit mode and then re-applied to it. `mkdir` applies a mode only to
// the directories it CREATES, so a home that already exists would keep whatever umask was in force
// the day `init` first ran — and `init` is the command that repairs a home. What the repair does
// is remove group and other access and restore the owner's own; it is not only a tightening,
// because a directory left at `0500` gains owner write back.
//
// A path that is a SYMLINK is created but never chmod'd. `chmod` follows links, so repairing one
// would silently change the mode of whatever it points at — a directory outside the home, which
// refs does not own and was never asked about. Pointing `sources` at another disk is a legitimate
// thing to do, and the mode of that target is its owner's business.
const applyDirMode = async (dir: string): Promise<void> => {
  await mkdir(dir, { mode: DIR_MODE, recursive: true });
  const link = await lstat(dir);
  if (!link.isSymbolicLink()) {
    await chmod(dir, DIR_MODE);
  }
};

/** Tightens a file `init` does not otherwise rewrite. `stampCliVersionIfChanged` returns without
 * writing when the version already matches, so a `config.toml` left readable by others on an older
 * refs would stay that way through every later `init`. */
const applyFileMode = async (path: string): Promise<void> => {
  try {
    await chmod(path, FILE_MODE);
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
  }
};

const ensureHomeDirs = async (home: RefsHome): Promise<void> => {
  for (const dir of [home.root, home.sourcesDir, home.locksDir, home.hooksDir]) {
    // eslint-disable-next-line no-await-in-loop -- a parent must exist before its child is made
    await applyDirMode(dir);
  }
  await Promise.all([applyFileMode(home.configPath), applyFileMode(home.statePath)]);
};

// Pure command body: no `--json`/`--verbose` of its own (only the global flags apply to `init`),
// so — unlike a command with its own options — there is no `opts` to thread through here.
const runInit = async (ctx: CliContext): Promise<InitData> => {
  const home = resolveHome(ctx.env);
  await ensureHomeDirs(home);
  const config = await withLock(home, 'home', async () => {
    const result = await migrateConfig(home, pkg.version);
    await installHooksGuard(home);
    return result;
  });
  return { config, home: home.root, skill_hint: SKILL_HINT };
};

const registerInit = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('init')
    .description('Seed or migrate the refs home directory, its config, and the git hooks guard.')
    .action((_localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const data = await runInit(ctx);
        emit(
          ctx,
          opts,
          [`home: ${data.home}`, `config: ${CONFIG_DISPLAY[data.config]}`, '', SKILL_HINT],
          data,
        );
      })();
    });
};

export { registerInit };
