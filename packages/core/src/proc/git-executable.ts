import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { assertExternalPath } from './git-helper-policy.ts';
import { canonicalRoot } from './git-config-paths.ts';
import { constants } from 'node:fs';

// libuv's Windows bare-command search checks the child's cwd before PATH. Never let a tracked
// git.exe/git.com become the first Git child, even for the configuration safety inventory itself.
const FAILURE = 'Cannot select a trusted external Git executable from PATH';
type ExecutableContext = { env: NodeJS.ProcessEnv; roots: readonly string[] };

const executableNames = (platform: NodeJS.Platform): readonly string[] =>
  platform === 'win32' ? ['git.exe', 'git.com'] : ['git'];

const searchDirectories = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] => {
  const keys = Object.keys(env).filter((key) =>
    platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH',
  );
  if (keys.length > 1) {
    throw new Error(FAILURE);
  }
  const path = keys[0] === undefined ? undefined : env[keys[0]];
  return (path ?? (platform === 'win32' ? '' : '/usr/bin:/bin')).split(
    platform === 'win32' ? ';' : delimiter,
  );
};

const candidateExecutable = async (path: string): Promise<string | undefined> => {
  try {
    await access(path, constants.X_OK);
    const entry = await stat(path);
    return entry.isFile() ? await realpath(path) : undefined;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'EACCES'].includes(String(error.code))
    ) {
      return undefined;
    }
    throw new Error(FAILURE, { cause: error });
  }
};

const resolveGitExecutable = async (
  context: ExecutableContext,
  platform: NodeJS.Platform = process.platform,
): Promise<string> => {
  const roots = await Promise.all(context.roots.map((root) => canonicalRoot(root)));
  const directories = searchDirectories(context.env, platform);
  for (const directory of directories) {
    // eslint-disable-next-line no-await-in-loop -- PATH order is meaningful
    await assertExternalPath(directory, roots);
    for (const name of executableNames(platform)) {
      // eslint-disable-next-line no-await-in-loop -- select the first usable executable
      const executable = await candidateExecutable(join(directory, name));
      if (executable !== undefined) {
        // Directory validation alone misses an external symlink into a reference checkout.
        // eslint-disable-next-line no-await-in-loop -- validate before returning this candidate
        await assertExternalPath(executable, roots);
        return executable;
      }
    }
  }
  throw new Error(FAILURE);
};

export { resolveGitExecutable };
