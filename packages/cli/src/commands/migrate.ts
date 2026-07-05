import { emit, wrapAction } from '../output.ts';
import { migrateConfig, resolveHome, withLock } from '@kaisers-io/refs-core';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
// eslint-disable-next-line import/no-relative-parent-imports -- package.json lives at the package root, one level above src/
import pkg from '../../package.json' with { type: 'json' };

interface MigrateData {
  backup: string | null;
  result: 'migrated' | 'noop' | 'seeded';
}

// Pure command body: `migrateConfig` alone decides seed/migrate/noop — this only adds the
// home-wide lock (matching `init.ts`'s own `withLock(home, 'home', ...)` wrapping of the same
// call) and derives the on-disk backup path from the result, since `migrateConfig` itself returns
// only the bare result string, never the backup path.
const runMigrate = async (ctx: CliContext): Promise<MigrateData> => {
  const home = resolveHome(ctx.env);
  const result = await withLock(home, 'home', () => migrateConfig(home, pkg.version));
  if (result === 'migrated') {
    return { backup: `${home.configPath}.bak`, result };
  }
  // eslint-disable-next-line unicorn/no-null -- cross-process JSON contract requires null, not undefined
  return { backup: null, result };
};

// Mirrors `edit.ts`'s `normalizeEditValue`/`renderValue` split: `data.backup` is a real filesystem
// path in the json envelope, but the human line only ever names the bare backup filename
// (`config.toml.bak`), not its full absolute path.
const migrateHuman = (data: MigrateData): string => {
  if (data.result === 'migrated') {
    return 'config migrated (backup: config.toml.bak)';
  }
  if (data.result === 'seeded') {
    return 'config seeded';
  }
  return 'config up to date';
};

const registerMigrate = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('migrate')
    .description('Migrate the refs config to the current schema, seeding it if absent.')
    .action((_localOpts, command) => {
      const globals = command.optsWithGlobals();
      const opts = { json: globals.json === true, verbose: globals.verbose === true };
      return wrapAction(ctx, opts, async () => {
        const data = await runMigrate(ctx);
        emit(ctx, opts, migrateHuman(data), data);
      })();
    });
};

export { registerMigrate, runMigrate };
export type { MigrateData };
