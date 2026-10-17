// Where a bare command name such as `git` is looked up before refs starts it.
//
// refs runs git with `cwd` set to a checkout, and a checkout is somebody else's repository. Left
// to itself, the spawn would look in that directory first on Windows: libuv's `search_path`
// (src/win/process.c) tries the child's working directory before PATH, like cmd.exe, unless
// `NoDefaultCurrentDirectoryInExePath` is set. A tracked `git.exe` or `git.com` at the root of a
// reference would then run in place of git on the next `refs sync`. On every platform an empty or
// relative PATH entry (`PATH=:/usr/bin`, `.`) means the same thing, because it is resolved against
// the child's working directory.
//
// So refs resolves the name itself, from absolute PATH entries only, and starts the absolute path
// it found. On Windows it tries `<name>.com`, then `<name>.exe` in each directory, the two
// extensions libuv would try, in its order, and the exact name first when it already carries an
// extension. A name that already contains a directory is left alone: refs only ever passes bare
// names, and a path is the caller's explicit choice.

import { access, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { constants } from 'node:fs';

type Platform = NodeJS.Platform;

const pathApi = (platform: Platform): typeof posix => (platform === 'win32' ? win32 : posix);

const pathValue = (env: NodeJS.ProcessEnv, platform: Platform): string => {
  const key = Object.keys(env).find((name) =>
    platform === 'win32' ? name.toUpperCase() === 'PATH' : name === 'PATH',
  );
  return key === undefined ? '' : (env[key] ?? '');
};

// libuv strips one pair of surrounding quotes from a Windows PATH entry; do the same, so a quoted
// absolute entry still counts and a quoted relative one still does not.
const unquoted = (entry: string): string => entry.replace(/^["'](?<inner>.*)["']$/su, '$<inner>');

const absoluteDirectories = (env: NodeJS.ProcessEnv, platform: Platform): string[] => {
  const api = pathApi(platform);
  return pathValue(env, platform)
    .split(api.delimiter)
    .map((entry) => (platform === 'win32' ? unquoted(entry) : entry))
    .filter((entry) => entry.length > 0 && api.isAbsolute(entry))
    .filter((entry) => platform !== 'win32' || /^(?:[a-z]:[\\/]|[\\/]{2})/iu.test(entry));
};

const fileNames = (name: string, platform: Platform): string[] => {
  if (platform !== 'win32') {
    return [name];
  }
  const withExtensions = [`${name}.com`, `${name}.exe`];
  return win32.extname(name) === '' ? withExtensions : [name, ...withExtensions];
};

const isRunnableFile = async (path: string, platform: Platform): Promise<boolean> => {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return false;
    }
    // Windows has no execute bit; X_OK there only checks existence.
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const hasDirectory = (name: string, platform: Platform): boolean =>
  platform === 'win32' ? /[\\/:]/u.test(name) : name.includes('/');

const search = async (
  name: string,
  env: NodeJS.ProcessEnv,
  platform: Platform,
): Promise<string | undefined> => {
  if (hasDirectory(name, platform)) {
    return name;
  }
  const api = pathApi(platform);
  const candidates = absoluteDirectories(env, platform).flatMap((directory) =>
    fileNames(name, platform).map((file) => api.join(directory, file)),
  );
  const runnable = await Promise.all(candidates.map((path) => isRunnableFile(path, platform)));
  return candidates[runnable.indexOf(true)];
};

// One lookup per name, PATH and platform for the life of the process: refs starts dozens of git
// commands per invocation, and the answer does not change underneath one.
const cache = new Map<string, Promise<string | undefined>>();

/** The absolute path `name` resolves to through absolute PATH entries only, or `undefined` when
 * none holds it. Never consults the working directory. */
const resolveExecutable = (
  name: string,
  env: NodeJS.ProcessEnv,
  platform: Platform = process.platform,
): Promise<string | undefined> => {
  const key = [platform, name, pathValue(env, platform)].join('\0');
  const found = cache.get(key) ?? search(name, env, platform);
  cache.set(key, found);
  return found;
};

export { resolveExecutable };
