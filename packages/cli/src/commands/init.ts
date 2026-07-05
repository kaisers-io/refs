import { emit, wrapAction } from '../output.ts';
import { installHooksGuard, migrateConfig, resolveHome, withLock } from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { RefsHome } from '@kaisers-io/refs-core';
import { mkdir } from 'node:fs/promises';
// eslint-disable-next-line import/no-relative-parent-imports -- package.json lives at the package root, one level above src/
import pkg from '../../package.json' with { type: 'json' };

// Printed verbatim in human mode and mirrored into `data.skill_hint` in json mode — this string
// Is only ever printed, never executed: `refs init` must stay free of anything network-facing
// (spec §8), so the actual `npx skills add` install step is left for the human/agent to run.
const SKILL_HINT =
  'Install the agent skill: npx skills add kaisers-io/refs   ' +
  '(private phase: npx skills add <path-to-this-repo> --skill refs)';

interface InitData {
  config: 'seeded' | 'migrated' | 'noop';
  home: string;
  skill_hint: string;
}

// Every home subdirectory `init` guarantees exists on return. Init's contract is that all four
// Exist unconditionally when it resolves — including on a `'noop'` run that touches neither
// `migrateConfig` nor `installHooksGuard` — so they are created up front here rather than relying
// On the incidental mkdir-recursive calls buried inside those two functions' own atomic-write
// Helpers (`withLock` itself also mkdir's `locksDir` recursively, independent of this).
const ensureHomeDirs = async (home: RefsHome): Promise<void> => {
  await mkdir(home.root, { recursive: true });
  await mkdir(home.sourcesDir, { recursive: true });
  await mkdir(home.locksDir, { recursive: true });
  await mkdir(home.hooksDir, { recursive: true });
};

// Pure command body: no `--json`/`--verbose` of its own (only the global flags apply to `init`),
// So — unlike a command with its own options — there is no `opts` to thread through here.
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
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const data = await runInit(ctx);
        emit(ctx, opts, [`refs home: ${data.home} (${data.config})`, SKILL_HINT], data);
      })();
    });
};

export { registerInit, runInit };
export type { InitData };
