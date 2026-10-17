// Each host writes into a new owned directory; user-selected destinations are never overwritten.
import { join, resolve } from 'node:path';
import { lstat, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { regularText } from './behavior-files.mjs';

const requireAbsent = async (path) => {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  throw new Error(`Report destination already exists; choose a new path: ${path}`);
};
const reportPaths = async (root, supplied) => {
  const results = join(root, 'evals', 'results');
  await mkdir(results, { recursive: true });
  const directory = await realpath(await mkdtemp(join(results, 'claude-')));
  const staged = join(directory, 'aggregate-result.json');
  const native = supplied ? resolve(supplied) : staged;
  const verified = native.replace(/\.json$/u, '.verified.json');
  await Promise.all([requireAbsent(native), requireAbsent(verified)]);
  return { native, staged, verified };
};
const readNative = async (paths) => {
  const text = await regularText(paths.staged);
  if (paths.native !== paths.staged) {
    await writeFile(paths.native, text, { flag: 'wx' });
  }
  return JSON.parse(text);
};

export { readNative, reportPaths };
