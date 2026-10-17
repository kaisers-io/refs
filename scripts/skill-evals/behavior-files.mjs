// Read source evidence without interpreting any generated command or running repository code.
import { join, resolve } from 'node:path';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const GIT_TIMEOUT_MS = 10_000;
const EXECUTABLE_BITS = 0o111;
const git = async (root, args) => {
  const { stdout } = await promisify(execFile)(
    'git',
    [
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=',
      '-c',
      'core.hooksPath=/dev/null',
      '-C',
      root,
      ...args,
    ],
    { timeout: GIT_TIMEOUT_MS },
  );
  return stdout.trimEnd();
};

const regularText = async (path) => {
  const info = await lstat(path);
  if (!info.isFile() || (await realpath(path)) !== resolve(path)) {
    throw new Error(`expected a regular file: ${path}`);
  }
  return readFile(path, 'utf8');
};

const snapshot = async (root, skipGit = false) => {
  const entries = await readdir(root, { withFileTypes: true });
  const groups = await Promise.all(
    entries
      .filter(({ name }) => !skipGit || name !== '.git')
      .map(async (entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
          const nested = await snapshot(path);
          return Object.entries(nested).map(([name, text]) => [join(entry.name, name), text]);
        }
        const info = await lstat(path);
        return [
          [
            entry.name,
            { executable: Boolean(info.mode & EXECUTABLE_BITS), text: await regularText(path) },
          ],
        ];
      }),
  );
  return Object.fromEntries(groups.flat());
};

const checkoutRoot = async (cwd, name) => {
  const expected = resolve(cwd, '.refs-home', 'refs', 'sources', 'local', 'fixtures', name);
  if ((await realpath(expected)) !== expected) {
    throw new Error(`managed root was replaced by a symlink: ${name}`);
  }
  const gitDir = await lstat(join(expected, '.git'));
  if (!gitDir.isDirectory()) {
    throw new Error(`managed checkout has no ordinary git directory: ${name}`);
  }
  return expected;
};

const absent = async (path) => {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return true;
  }
};

export { absent, checkoutRoot, git, regularText, snapshot };
