// When `SpawnRunner` takes the configured-hook label inventory (`git-hook-labels.ts`), and where it
// keeps it between commands (`git-hook-label-cache.ts`).

import type { HookLabelCache } from './git-hook-label-cache.ts';
import type { LabelContext } from './git-hook-labels.ts';
import type { RunResult } from './runner.ts';
import { hookLabelArgs } from './git-hook-labels.ts';
import { inventoryKey } from './git-hook-label-cache.ts';

// Configured hooks exist from git 2.54. An unreadable version gets no inventory: the probe fails
// only when git cannot start, and then neither can the command it guards.
const GIT_VERSION = /^git version (?<major>\d+)\.(?<minor>\d+)/u;
const FIRST_WITH_HOOKS = { major: 2, minor: 54 } as const;

const hasConfiguredHooks = (version: string): boolean => {
  const groups = GIT_VERSION.exec(version.trim())?.groups;
  const major = Number(groups?.['major'] ?? 0);
  const minor = Number(groups?.['minor'] ?? 0);
  return (
    major > FIRST_WITH_HOOKS.major ||
    (major === FIRST_WITH_HOOKS.major && minor >= FIRST_WITH_HOOKS.minor)
  );
};

// Exit code of a git command refs refused to start; the reason is in `stderr`.
const REFUSED_EXIT_CODE = 1;

type SpawnGit = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<RunResult>;
type PolicyContext = Omit<LabelContext, 'cache'> & { cache?: HookLabelCache; version: string };

/** Whether `args` is the version probe, which must not wait on the version. */
const isVersionProbe = (args: readonly string[]): boolean =>
  args.length === 1 && args[0] === '--version';

/** The label arguments for one git command on the git that printed `version`: none before 2.54.
 *
 * The inventory runs without `GIT_CONFIG`: that variable redirects the `config` subcommand alone,
 * so with it set the listing would describe a file the guarded command never reads. */
const hookLabelPolicy = (
  spawnGit: SpawnGit,
  ctx: PolicyContext,
): Promise<{ args: string[] } | { refusal: string }> => {
  if (!hasConfiguredHooks(ctx.version)) {
    return Promise.resolve({ args: [] });
  }
  const { GIT_CONFIG: _ignored, ...env } = process.env;
  const { cache, version: _version, ...label } = ctx;
  return hookLabelArgs((args) => spawnGit(args, env), {
    ...label,
    ...(cache === undefined ? {} : { cache: { key: inventoryKey(ctx.cwd, env), store: cache } }),
  });
};

export { REFUSED_EXIT_CODE, hookLabelPolicy, isVersionProbe };
