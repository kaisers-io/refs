import type { CliContext } from '../context.ts';
import { checkGitExecSurfaces } from './doctor-checks-git-config.ts';
import { progress } from '../output.ts';

// Emit before cloning, also with --json (stderr); retain in the final JSON warnings as well.
// This is visibility, not an approval boundary or an exhaustive includeIf inventory.
const addGitWarning = async (ctx: CliContext, cwd: string): Promise<string | undefined> => {
  const check = await checkGitExecSurfaces(ctx, cwd);
  if (check.status !== 'warn') {
    return undefined;
  }
  const warning = `${check.name}: ${check.detail}`;
  progress(ctx, `warning: ${warning}`);
  return warning;
};

export { addGitWarning };
